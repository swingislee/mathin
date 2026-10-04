"""Read-only OOXML extraction retaining cells, formulas and horizontal roster context."""
import argparse
import datetime
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import xml.etree.ElementTree as ET
import zipfile

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
NAME = re.compile(r'^(?:学员姓名|学生姓名|孩子姓名|姓名|宝宝姓名|儿童姓名)$')
PHONE = re.compile(r'^(?:手机号|手机号码|联系电话|联系方式|电话|家长电话|家长手机号|家长手机号码)$')
NARRATIVE = re.compile(r'备注|沟通|跟进|情况|反馈|诉求|建议|关注|记录|说明|原因')
DATE = re.compile(r'日期|时间|到访日|报名日')

def digest(value):
    return hashlib.sha256(value).hexdigest()

def text(v):
    if v is None:
        return ''
    return str(v)

def column_index(ref):
    n = 0
    for c in re.sub(r'\d', '', ref):
        n = n * 26 + ord(c) - 64
    return n

def read_xlsx(file):
    content = file.read_bytes()
    sha = digest(content)
    source_id = 'xlsx:' + sha
    source = {'id': source_id, 'filename': file.name, 'sha256': sha, 'format': 'xlsx'}
    tables, records, warnings = [], [], []
    # 哈希和解析读取同一份字节，来源文件随后变化也不会产生不一致档案。
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            shared = [''.join(t.text or '' for t in si.iter('{'+NS['m']+'}t')) for si in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        rels = {r.attrib['Id']: r.attrib['Target'] for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        wb = ET.fromstring(z.read('xl/workbook.xml'))
        date1904 = wb.find('m:workbookPr', NS)
        epoch = datetime.datetime(1904, 1, 1) if date1904 is not None and date1904.get('date1904') in {'1', 'true'} else datetime.datetime(1899, 12, 30)
        styles, formats = [], {}
        if 'xl/styles.xml' in z.namelist():
            sx = ET.fromstring(z.read('xl/styles.xml'))
            formats = {int(x.get('numFmtId')): x.get('formatCode', '') for x in sx.findall('m:numFmts/m:numFmt', NS)}
            styles = [int(x.get('numFmtId', '0')) for x in sx.findall('m:cellXfs/m:xf', NS)]
        for sheet in wb.findall('m:sheets/m:sheet', NS):
            name = sheet.get('name')
            target = rels[sheet.attrib[REL]]
            part = target.lstrip('/') if target.startswith('/') else str(PurePosixPath('xl') / target)
            xml = ET.fromstring(z.read(part))
            table_id = 'xlsx-table:' + digest((source_id + '\n' + name).encode())[:32]
            grid = {}
            for c in xml.findall('m:sheetData/m:row/m:c', NS):
                ref = c.attrib['r']
                row = int(re.search(r'\d+', ref)[0])
                col = column_index(ref)
                typ = c.get('t', 'n')
                value_element = c.find('m:v', NS)
                raw = value_element.text if value_element is not None else None
                formula = c.find('m:f', NS)
                if typ == 's' and raw is not None:
                    value = shared[int(raw)]
                elif typ == 'inlineStr':
                    value = ''.join(t.text or '' for t in c.findall('.//m:t', NS))
                else:
                    value = raw
                style = int(c.get('s', '0'))
                fmt_id = styles[style] if style < len(styles) else 0
                fmt = formats.get(fmt_id, '')
                is_date = fmt_id in {14, 15, 16, 17, 22} or bool(re.search(r'[yd]', re.sub(r'"[^"]*"|\[[^\]]*\]', '', fmt), re.I))
                display = text(value)
                if typ == 'n' and raw and is_date:
                    try:
                        date = epoch + datetime.timedelta(days=float(raw))
                        display = date.isoformat(sep=' ', timespec='seconds') if date.time() != datetime.time() else date.date().isoformat()
                    except (ValueError, OverflowError):
                        pass
                cell = {'ref': ref, 'value': value, 'xmlValue': raw, 'cellType': typ, 'style': style, 'numberFormat': fmt or fmt_id}
                if formula is not None:
                    cell['formula'] = formula.text or ''
                    cell['formulaAttributes'] = formula.attrib
                    if raw is None:
                        display = '=' + (formula.text or '')
                if display or formula is not None:
                    grid.setdefault(row, {})[col] = (display, cell)
            # Detect conventional identity headers; other layouts retain positional context.
            def score(row):
                values = [v[0].strip().replace(' ', '') for v in row.values()]
                return sum(3 if NAME.fullmatch(v) or PHONE.fullmatch(v) else 1 if NARRATIVE.search(v) else 0 for v in values)
            early = [(row, cells) for row, cells in grid.items() if row <= 15]
            best = max(early, key=lambda pair: score(pair[1]), default=(0, {}))
            header_row = best[0] if score(best[1]) >= 3 else 0
            headers = {col: v[0].strip() for col, v in grid.get(header_row, {}).items()}
            # 一行横向放置多名学生时，原列位置是身份边界，不能合并成一个家庭。
            name_header_count = sum(bool(NAME.fullmatch(re.sub(r'\s+', '', header))) for header in headers.values())
            horizontal_identity_layout = name_header_count > 1
            merges = [c.attrib['ref'] for c in xml.findall('m:mergeCells/m:mergeCell', NS)]
            # The header itself is retained as an archive record, not discarded.
            for row, values in sorted(grid.items()):
                names, phones, cells, dates, row_warnings = [], [], [], [], []
                for col, (display, raw) in sorted(values.items()):
                    letter = re.sub(r'\d', '', raw['ref'])
                    header = headers.get(col, '')
                    field_name = f'{header} [{letter}]' if header and row != header_row else letter
                    normalized_header = re.sub(r'\s+', '', header)
                    identity_allowed = header_row > 0 and row > header_row and not horizontal_identity_layout
                    kind = 'context'
                    if identity_allowed and NAME.fullmatch(normalized_header):
                        kind = 'identity'
                        if display.strip(): names.append(display.strip())
                    elif identity_allowed and PHONE.fullmatch(normalized_header):
                        kind = 'identity'
                        phones.extend(re.findall(r'(?<!\d)(?:\+?86[ -]?)?(1[3-9]\d{9})(?!\d)', display.replace(' ', '').replace('-', '')))
                    elif header and NARRATIVE.search(header):
                        kind = 'narrative'
                    if header_row > 0 and row > header_row and header and DATE.search(header) and display and 'formula' not in raw:
                        dates.append(f'{header}: {display}')
                    if 'formula' in raw and raw['xmlValue'] is None:
                        row_warnings.append('formula_without_cached_value')
                    cells.append({'fieldId': raw['ref'], 'fieldName': field_name, 'type': raw['cellType'], 'text': display, 'rawValue': raw, 'kind': kind})
                if not header_row:
                    row_warnings.append('positional_layout_requires_identity_review')
                if horizontal_identity_layout:
                    row_warnings.append('horizontal_layout_requires_identity_review')
                records.append({'id': 'xlsx-record:' + digest((table_id + ':' + str(row)).encode())[:40], 'sourceId': source_id, 'tableId': table_id,
                    'tableName': name, 'sourceRecordId': str(row), 'sourceRow': row, 'label': ' / '.join(dict.fromkeys(names)) or f'{name} · {row}',
                    'names': list(dict.fromkeys(names)), 'phones': list(dict.fromkeys(phones)), 'cells': cells, 'links': [],
                    'dateLabel': '；'.join(dates) or None, 'hasContent': True, 'warnings': sorted(set(row_warnings))})
            tables.append({'id': table_id, 'name': name, 'rowCount': len(grid), 'contentRowCount': len(grid), 'headerRow': header_row, 'mergedRanges': merges})
    return {'source': source, 'tables': tables, 'records': records, 'warnings': warnings}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    source = Path(args.source).resolve()
    destination = Path(args.output).resolve()
    if destination.exists():
        raise SystemExit('Output already exists; use a new extraction path')
    extracted = [read_xlsx(file) for file in sorted(source.rglob('*.xlsx'))]
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(extracted, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({'sources': len(extracted), 'tables': sum(len(x['tables']) for x in extracted), 'records': sum(len(x['records']) for x in extracted)}))

if __name__ == '__main__':
    main()

"""Synthetic OOXML regression checks; no external packages or business data."""
import hashlib
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from xml.sax.saxutils import escape
import zipfile


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'history-archive-excel.py'
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location('history_archive_excel', SCRIPT)
ARCHIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ARCHIVE)


def inline(ref, value):
    return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{escape(value)}</t></is></c>'


def numeric(ref, value, style=None):
    style_attribute = f' s="{style}"' if style is not None else ''
    return f'<c r="{ref}"{style_attribute}><v>{value}</v></c>'


def row(number, *cells):
    return f'<row r="{number}">{"".join(cells)}</row>'


class HistoryArchiveExcelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='mathin-synthetic-xlsx-')
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)

    def workbook(self, rows, *, dimension='A1', formats='', extra='', date1904=False):
        path = self.directory / 'synthetic.xlsx'
        namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
        relationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
        with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as workbook:
            workbook.writestr('xl/workbook.xml', (
                f'<workbook xmlns="{namespace}" xmlns:r="{relationships}">'
                f'<workbookPr date1904="{"true" if date1904 else "false"}"/>'
                '<sheets><sheet name="合成历史资料" sheetId="1" r:id="rId1"/></sheets></workbook>'
            ))
            workbook.writestr('xl/_rels/workbook.xml.rels', (
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" Target="worksheets/sheet1.xml" '
                f'Type="{relationships}/worksheet"/></Relationships>'
            ))
            workbook.writestr('xl/worksheets/sheet1.xml', (
                f'<worksheet xmlns="{namespace}"><dimension ref="{dimension}"/>'
                f'<sheetData>{"".join(rows)}</sheetData>{extra}</worksheet>'
            ))
            if formats:
                workbook.writestr('xl/styles.xml', f'<styleSheet xmlns="{namespace}">{formats}</styleSheet>')
        return path

    def test_wrong_dimension_keeps_sparse_cells_and_long_content(self):
        narrative = '合成内容\n' + '全文' * 5000
        source = self.workbook([
            row(1, inline('A1', '资料标题')),
            row(28, inline('Z28', narrative), numeric('AB28', 42)),
        ])
        result = ARCHIVE.read_xlsx(source)
        self.assertEqual(result['tables'][0]['rowCount'], 2)
        self.assertEqual([record['sourceRow'] for record in result['records']], [1, 28])
        cells = result['records'][1]['cells']
        self.assertEqual([cell['fieldId'] for cell in cells], ['Z28', 'AB28'])
        self.assertEqual(cells[0]['text'], narrative)
        self.assertEqual(cells[0]['rawValue']['value'], narrative)
        self.assertEqual(result['records'][1]['names'], [])
        self.assertIn('positional_layout_requires_identity_review', result['records'][1]['warnings'])

    def test_explicit_headers_identify_body_only_and_do_not_parse_remarks(self):
        source = self.workbook([
            row(1, inline('A1', '学生姓名'), inline('B1', '家长手机号'), inline('C1', '沟通备注'), inline('D1', '报名日期')),
            row(2, inline('A2', '合成学生甲'), inline('B2', '+86 13800000000'), inline('C2', '备注提及 13900000000'), inline('D2', '去年秋季')),
            row(3, inline('A3', '合成学生乙'), inline('B3', '137****0000')),
        ])
        result = ARCHIVE.read_xlsx(source)
        header, student, masked = result['records']
        self.assertEqual(result['tables'][0]['headerRow'], 1)
        self.assertEqual(header['names'], [])
        self.assertEqual(header['phones'], [])
        self.assertIsNone(header['dateLabel'])
        self.assertEqual(student['names'], ['合成学生甲'])
        self.assertEqual(student['phones'], ['13800000000'])
        self.assertEqual(student['dateLabel'], '报名日期: 去年秋季')
        self.assertEqual(student['cells'][2]['kind'], 'narrative')
        self.assertEqual(masked['phones'], [])

    def test_horizontal_children_remain_positional_without_combined_person(self):
        source = self.workbook([
            row(1, inline('A1', '班级甲'), inline('D1', '班级乙')),
            row(2, inline('A2', '姓名'), inline('B2', '家长电话'), inline('D2', '姓名'), inline('E2', '家长电话')),
            row(3, inline('A3', '合成学生甲'), inline('B3', '13800000000'), inline('D3', '合成学生乙'), inline('E3', '13900000000')),
        ], extra='<mergeCells count="2"><mergeCell ref="A1:B1"/><mergeCell ref="D1:E1"/></mergeCells>')
        result = ARCHIVE.read_xlsx(source)
        record = result['records'][2]
        self.assertEqual(record['names'], [])
        self.assertEqual(record['phones'], [])
        self.assertEqual([cell['text'] for cell in record['cells']], ['合成学生甲', '13800000000', '合成学生乙', '13900000000'])
        self.assertEqual([cell['fieldId'] for cell in record['cells']], ['A3', 'B3', 'D3', 'E3'])
        self.assertIn('horizontal_layout_requires_identity_review', record['warnings'])
        self.assertEqual(result['tables'][0]['mergedRanges'], ['A1:B1', 'D1:E1'])

    def test_formula_without_cache_keeps_formula_and_cached_values_are_not_recomputed(self):
        source = self.workbook([
            row(1, inline('A1', '姓名'), inline('B1', '报名日期'), inline('C1', '计算值')),
            row(2, inline('A2', '合成学生甲'), '<c r="B2"><f>SUM(A8:A9)</f></c>', '<c r="C2"><f>1+1</f><v>99</v></c>'),
        ])
        record = ARCHIVE.read_xlsx(source)['records'][1]
        self.assertEqual(record['cells'][1]['text'], '=SUM(A8:A9)')
        self.assertEqual(record['cells'][1]['rawValue']['formula'], 'SUM(A8:A9)')
        self.assertIsNone(record['cells'][1]['rawValue']['xmlValue'])
        self.assertIn('formula_without_cached_value', record['warnings'])
        self.assertEqual(record['cells'][2]['text'], '99')
        self.assertEqual(record['cells'][2]['rawValue']['formula'], '1+1')
        self.assertIsNone(record['dateLabel'])

    def test_dates_keep_serial_and_format_in_both_excel_epochs(self):
        styles = '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs>'
        source = self.workbook([
            row(1, inline('A1', '姓名'), inline('B1', '沟通日期')),
            row(2, inline('A2', '合成学生甲'), numeric('B2', '45292', style=1)),
        ], formats=styles)
        record = ARCHIVE.read_xlsx(source)['records'][1]
        self.assertEqual(record['cells'][1]['text'], '2024-01-01')
        self.assertEqual(record['cells'][1]['rawValue']['value'], '45292')
        self.assertEqual(record['cells'][1]['rawValue']['xmlValue'], '45292')
        self.assertEqual(record['cells'][1]['rawValue']['numberFormat'], 'yyyy-mm-dd')
        alternate = self.workbook([row(1, numeric('B1', '0', style=1))], formats=styles, date1904=True)
        self.assertEqual(ARCHIVE.read_xlsx(alternate)['records'][0]['cells'][0]['text'], '1904-01-01')

    def test_hash_and_ids_follow_exact_bytes_and_are_path_independent(self):
        source = self.workbook([row(1, inline('A1', '姓名')), row(2, inline('A2', '合成学生甲'))])
        content = source.read_bytes()
        first = ARCHIVE.read_xlsx(source)
        copied = self.directory / 'copied.xlsx'
        copied.write_bytes(content)
        second = ARCHIVE.read_xlsx(copied)
        self.assertEqual(first['source']['sha256'], hashlib.sha256(content).hexdigest())
        self.assertEqual(first['source']['id'], second['source']['id'])
        self.assertEqual(first['records'], second['records'])
        self.assertEqual(source.read_bytes(), content)


if __name__ == '__main__':
    unittest.main()

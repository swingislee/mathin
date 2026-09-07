import { describe, expect, it } from 'vitest';
import { classifyHistorySource, historyFieldDisposition, summarizeHistoryTable } from '../scripts/lib/history-data-catalog.mjs';

const source = { id: 'xlsx:source', filename: '员工管理.xlsx', format: 'xlsx' };
const cell = (fieldId: string, text: string, rawValue: Record<string, unknown> = {}) => ({ fieldId, fieldName: fieldId, text, kind: 'context', type: 's', rawValue });
const record = (id: string, sourceRow: number, cells: ReturnType<typeof cell>[]) => ({ id, sourceRow, cells, hasContent: true });
const table = { id: 'table', name: 'sheetName', headerRow: 1 };
const noMatches = new Map();
describe('history source catalog', () => {
  it('keeps employee matches out of student totals and never changes the matching snapshot', () => {
    const matches = new Map([['employee', { status: 'matched', entityKey: 'student' }]]);
    const input = { source, table, records: [record('header', 1, [cell('A1', '姓名')]), record('employee', 2, [cell('A2', '示例员工')])],
      matches, entities: new Map([['student', { kind: 'student' }]]) };
    const before = structuredClone(input);
    const result = summarizeHistoryTable(input);
    expect(result.counts).toMatchObject({ rawRows: 2, headerRows: 1, dataRows: 1, matchedStudentRows: 0, inapplicableRows: 1, ignoredSnapshotMatches: 1 });
    expect(input).toEqual(before);
  });
  it('uses the verified class header instead of counting it as a class', () => {
    const result = summarizeHistoryTable({ source: { ...source, filename: '班级列表导出数据.xlsx' }, table: { ...table, headerRow: 0 },
      records: [record('header', 1, [cell('A1', '班级ID'), cell('B1', '班级名称')]), record('class', 2, [cell('A2', 'class-source'), cell('B2', '原班级')])],
      matches: noMatches, entities: noMatches });
    expect(result.counts).toMatchObject({ headerRows: 1, dataRows: 1 });
    expect(result.fields[0]).toMatchObject({ key: 'A', name: '班级ID', filledCells: 1 });
  });
  it('retains empty fields and counts shared formulas without cached values separately', () => {
    const result = summarizeHistoryTable({ source: { ...source, filename: '子2：报名学员信息与2024课表【数据系列2】.xlsx' }, table: { ...table, name: '学员报名信息' },
      records: [record('header', 1, [cell('A1', '老师'), cell('B1', '报名日期')]), record('data', 2, [cell('A2', '=', { formula: '', xmlValue: null })])],
      matches: noMatches, entities: noMatches });
    expect(result.counts.missingFormulaCells).toBe(1);
    expect(result.fields).toEqual(expect.arrayContaining([expect.objectContaining({ name: '报名日期', filledCells: 0 }),
      expect.objectContaining({ name: '老师', filledCells: 0, missingFormulaCells: 1, target: '历史授课安排' })]));
  });
  it('keeps shared roster rows at cell scope even if the old matcher found one student', () => {
    expect(classifyHistorySource({ ...source, filename: '子2：报名学员信息与2024课表【数据系列2】.xlsx' }, { name: '讲义' }).identityScope).toBe('cell_review');
    expect(classifyHistorySource({ ...source, filename: '未知.xlsx' }, { name: '新表' })).toMatchObject({ known: false, kind: 'ambiguous', identityScope: 'cell_review' });
  });
  it('separates competition registration dates from course enrollment dates and preserves renewal gaps', () => {
    const field = { key: 'date', name: '报名日期', kind: 'context', formulaCount: 0 };
    expect(historyFieldDisposition('activity', field).target).toBe('活动报名日期');
    expect(historyFieldDisposition('enrollment', field).target).toBe('各期历史报名');
    expect(historyFieldDisposition('renewal', { ...field, name: '是否续报' })).toMatchObject({ target: '续班、新报与结果', coverage: '待补规则' });
    expect(historyFieldDisposition('assessment', { ...field, name: '学服老师' }).target).toBe('历史经办人与服务关系');
  });
});

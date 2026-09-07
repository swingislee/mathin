import { describe, expect, it } from 'vitest';
import {
  compareBaseRevisions, createPersonIndex, createStaffIndex, horizontalRosterPeople,
  isPlaceholderStaff, locateWorkbooks, matchPerson, normalizeTime, phonesIn, reconcileSources,
} from '../scripts/lib/source-reconciliation.mjs';

const employee = (id: string, name: string) => ({ id, name });
const cell = (ref: string, text: string) => ({ fieldId: ref, fieldName: ref, type: 's', text, kind: 'context', rawValue: { ref } });
const row = (tableId: string, sourceRow: number, values: Record<string, string>, tableName = 'Sheet1') => ({
  id: `${tableId}:${sourceRow}`, key: `${tableId}:${sourceRow}`, tableId, tableName, sourceRow, sourceRecordId: String(sourceRow),
  hasContent: true, cells: Object.entries(values).map(([col, text]) => cell(`${col}${sourceRow}`, text)),
});
const workbook = (filename: string, data: ReturnType<typeof row>[], headerRow = 1) => ({ source: { filename, sha256: filename, id: filename },
  sourcePath: filename, tables: [...new Set(data.map(r => r.tableId))].map(id => ({ id, name: data.find(r => r.tableId === id)!.tableName, headerRow })), records: data });

describe('employee source reconciliation', () => {
  it('excludes subject and grade placeholders while retaining real and bilingual names', () => {
    for (const name of ['数学老师1', '数学A', '英语Ｄ', '小低老师A', '小高老师', '专业思维老师', '初中老师A', '待定']) expect(isPlaceholderStaff(name), name).toBe(true);
    for (const name of ['方老师', '林莉Lily', '魏语文', '陈思维', '阿明']) expect(isPlaceholderStaff(name), name).toBe(false);
  });
  it('uses the current roster, explicit bilingual aliases, and history for absent real names', () => {
    const staff = createStaffIndex([employee('1', '林莉Lily'), employee('2', '数学老师1')]);
    expect(staff.match('林莉')).toMatchObject({ status: 'current', employeeId: '1', importEligible: true });
    expect(staff.match('Lily')).toMatchObject({ status: 'current', employeeId: '1' });
    expect(staff.match('王晓')).toMatchObject({ status: 'historical', employeeId: null, importEligible: false });
    expect(staff.match('数学老师1')).toMatchObject({ status: 'placeholder', employeeId: null, importEligible: false });
    expect(staff.match('王老师')).toMatchObject({ status: 'review', employeeId: null });
    expect(staff.match('小红书')).toMatchObject({ status: 'source_label', employeeId: null });
    expect(staff.match('林姐')).toMatchObject({ status: 'review', employeeId: null });
  });
  it('requires source evidence for aliases and rejects an alias to a placeholder or collision', () => {
    const roster = [employee('1', '陈小薇'), employee('2', '数学A')];
    expect(() => createStaffIndex(roster, [{ name: '小薇', employeeId: '1' }])).toThrow('STAFF_ALIAS_CONFIRMATION_REQUIRED');
    const alias = { name: '小薇', employeeId: '1', confirmedBy: '产品负责人', evidence: '明确确认同一人' };
    expect(createStaffIndex(roster, [alias]).match('小薇')).toMatchObject({ status: 'current', employeeId: '1' });
    expect(() => createStaffIndex(roster, [{ ...alias, employeeId: '2' }])).toThrow('STAFF_ALIAS_CONFLICT');
    expect(() => createStaffIndex(roster, [{ ...alias, name: '陈小薇' }])).toThrow('STAFF_ALIAS_CONFLICT');
  });
  it('retains ambiguity when two staff share a short bilingual alias', () => {
    const staff = createStaffIndex([employee('1', '林莉Lily'), employee('2', '陈莉Lily')]);
    expect(staff.match('Lily')).toMatchObject({ status: 'review', employeeId: null });
  });
});

describe('person evidence boundaries', () => {
  const people = [
    { id: 'child-a', names: ['林小安'], phones: ['13811112222'] },
    { id: 'child-b', names: ['林小宁'], phones: ['13811112222'] },
    { id: 'other-family', names: ['林小安'], phones: ['13922223333'] },
  ];
  const index = createPersonIndex(people);
  it('preserves separate children sharing a family phone', () => {
    expect(matchPerson({ name: '林小安', phones: ['13811112222'] }, index)).toMatchObject({ status: 'matched', personId: 'child-a' });
    expect(matchPerson({ name: '林小宁', phones: ['13811112222'] }, index)).toMatchObject({ status: 'matched', personId: 'child-b' });
    expect(matchPerson({ name: '林妈妈', phones: ['13811112222'] }, index)).toMatchObject({ status: 'review', method: 'family_phone_only', personId: null });
  });
  it('does not select the first namesake or ignore a contradictory second phone', () => {
    expect(matchPerson({ name: '林小安' }, index)).toMatchObject({ status: 'review', method: 'name_only', candidateIds: ['child-a', 'other-family'] });
    expect(matchPerson({ name: '林小安', phones: ['13811112222', '13922223333'] }, index)).toMatchObject({ status: 'review', personId: null });
    const duplicate = createPersonIndex([...people, { ...people[0], id: 'duplicate' }]);
    expect(matchPerson({ name: '林小安', phones: ['13811112222'] }, duplicate)).toMatchObject({ status: 'review', method: 'duplicate_name_phone', personId: null });
  });
  it('accepts complete phone formats and retains annotated names for review', () => {
    expect(phonesIn('+86 138-1111-2222 / 139****3333 / 13900000008 / 17777777777')).toEqual(['13811112222']);
    expect(matchPerson({ name: '林小安（停课）', phones: ['13811112222'] }, index)).toMatchObject({ status: 'review', personId: null });
    expect(normalizeTime('9：00 - 11：30')).toBe('09:00-11:30');
  });
});

describe('source identity and revisions', () => {
  it('retains distinct class files even when both contain identical empty headers', () => {
    const input = ['甲班-1.xlsx', '乙班-2.xlsx'].map(filename => ({ ...workbook(filename, [row('same-table', 1, { A: '班级名称' })]), source: { filename, sha256: 'identical' } }));
    const result = locateWorkbooks(input, input.map(w => ({ path: `导出/班级学生明细/${w.source.filename}`, sha256: 'identical' })));
    expect(new Set(result.map(w => w.records[0].key)).size).toBe(2);
    expect(input[0].records[0].key).toBe('same-table:1');
  });
  it('splits horizontal students at source cells and retains each class block context', () => {
    const book = workbook('子2.xlsx', [
      row('roster', 2, { A: '老师', B: '学员姓名', F: '老师', G: '学员姓名' }),
      row('roster', 3, { B: '1', C: '2', G: '1', H: '2' }),
      row('roster', 4, { A: '陈老师', B: '林小安', C: '林小宁', F: '李老师', G: '王小贝' }),
    ], 2);
    const result = horizontalRosterPeople(book);
    expect(result).toHaveLength(3);
    expect(result.map(r => [r.name, r.cell, r.context.老师])).toEqual([
      ['林小安', 'B4', '陈老师'], ['林小宁', 'C4', '陈老师'], ['王小贝', 'G4', '李老师'],
    ]);
  });
  it('reports display changes separately from changed export representation and preserves absent rows', () => {
    const record = (id: string, text: string, rawValue: unknown) => ({ tableId: 't', tableName: '业务表', sourceRecordId: id, hasContent: true,
      cells: [{ fieldId: 'f', fieldName: '姓名', kind: 'identity', text, rawValue }] });
    const before = { source: { id: 'base', sha256: 'before' }, records: [record('keep', '原姓名', [{ text: '原姓名' }]), record('absent', '离开本次导出', '')] };
    const after = { source: { id: 'base', sha256: 'after' }, records: [record('keep', '原姓名', [{ text: '原姓名', type: 'text' }]), record('new', '新记录', '')] };
    const result = compareBaseRevisions(before, after);
    expect(result.totals).toMatchObject({ changedRecords: 0, changedFields: 0, representationChangedRecords: 1, addedRecords: 1, absentRecords: 1 });
    expect(before.records).toHaveLength(2);
  });
});

function fixture() {
  const record = (id: string, values: Record<string, string>) => ({ tableId: 'autumn', tableName: '2026秋季在读学员表格', sourceRecordId: id, hasContent: true,
    cells: Object.entries(values).map(([fieldName, text]) => ({ fieldId: fieldName, fieldName, text, rawValue: text, kind: 'context', type: 'Text' })) });
  const autumnValues = { 姓名: '林小安', 校区: '紫辰', 年级: '1年级', 班型: 'A+', 授课学科老师: '陈小薇', '26秋上课周次': '周六', '26秋上课时段': '9：00-11：00', '26秋在读': '是' };
  const base = { source: { id: 'base', filename: '主表.base' }, tables: [{ id: 'autumn', name: '2026秋季在读学员表格', rowCount: 2, contentRowCount: 2 }],
    records: [record('student', autumnValues), record('blank', { ...autumnValues, 姓名: '', '26秋在读': '', '26秋报名模式': '待报' })], warnings: [] };
  const rosterHeader = { A: '班级名称', F: '老师', K: '学生ID', L: '学生姓名', N: '联系电话', Q: '状态' };
  const rosterBody = { A: '一年级秋季A+周六', F: '陈小薇', K: '100', L: '林小安', N: '13811112222', Q: '在班学生' };
  const books = [
    workbook('员工管理.xlsx', [row('staff', 1, { A: 'ID', B: '姓名', C: '手机号' }), row('staff', 2, { A: '1', B: '陈小薇' })]),
    workbook('2026-09-07_学生管理-学生列表.xlsx', [row('master', 1, { A: '学生ID', C: '学生姓名', D: '联系电话' }), row('master', 2, { A: '100', C: '林小安', D: '13811112222', G: '历史', N: '无年级' })]),
    workbook('2026-09-07_未开课与开课中班级列表导出数据.xlsx', [row('classes', 1, { A: '班级ID', B: '班级名称', L: '班级老师', S: '班级状态' }),
      row('classes', 2, { A: '300', B: '一年级秋季A+周六', H: '1年级', I: '秋季', L: '陈小薇', M: '紫辰阁', P: '1', S: '开课中', T: '2026-09-01', V: '09:00-11:00' })]),
    workbook('班级学生汇总.xlsx', [row('summary', 1, rosterHeader), row('summary', 2, rosterBody)]),
    workbook('一年级-300.xlsx', [row('detail', 1, rosterHeader), row('detail', 2, rosterBody)]),
    workbook('校区与教室管理.xlsx', [row('campus', 1, { A: '紫辰阁', B: '原地址', C: '已启用' }, '校区管理'), row('rooms', 1, { A: 'Z301', C: '紫辰阁', D: '已启用' }, '教室管理')]),
  ];
  const manifest = books.map(book => ({ path: book.source.filename.endsWith('-300.xlsx') ? `导出/班级学生明细/${book.source.filename}` : book.source.filename, sha256: book.source.sha256 }));
  return { base, workbooks: books, manifest };
}

describe('business authority integration', () => {
  it('uses current class evidence for identity and retains the authoritative in-study state despite reference history', () => {
    const input = fixture(); const before = structuredClone(input);
    const result = reconcileSources(input);
    expect(result.currentAutumn[0]).toMatchObject({ businessState: 'in_study', match: { status: 'matched', personId: '100' } });
    expect(result.currentAutumn[0].differences).toContainEqual({ field: '在读状态', authority: '是', reference: '历史' });
    expect(result.currentAutumn[1]).toMatchObject({ businessState: 'pending_registration', match: { status: 'unmatched', personId: null } });
    expect(result.magic.totals).toMatchObject({ summaryStudentRows: 1, detailStudentRows: 1, differentRosterSignatures: 0 });
    expect(result.businessWrites).toBe(0);
    expect(input).toEqual(before);
  });
  it('does not use a prior-year open class to establish current identity', () => {
    const input = fixture(); input.workbooks[2].records[1].cells.find(c => c.fieldId === 'T2')!.text = '2025-09-01';
    const result = reconcileSources(input);
    expect(result.currentAutumn[0]).toMatchObject({ businessState: 'in_study', classCandidateIds: [], match: { status: 'review', method: 'name_only', personId: null } });
  });
  it('detects an actual summary/detail mismatch instead of summing the two exports', () => {
    const input = fixture(); input.workbooks[3].records[1].cells.find(c => c.fieldId === 'N2')!.text = '13922223333';
    const result = reconcileSources(input);
    expect(result.magic.totals).toMatchObject({ summaryStudentRows: 1, detailStudentRows: 1, differentRosterSignatures: 2 });
  });
});

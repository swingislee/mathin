import { describe, expect, it } from 'vitest';
import { baseBusinessFieldsSchema } from '../src/features/school/base-business-fields-schema.mjs';
import type { BaseBusinessField } from '../src/features/school/base-business-fields-contract';
import { buildBaseBusinessPlan, organizeBaseRecord, parseBaseDate } from '../scripts/lib/base-business-fields.mjs';

const source = (id: string, tableName: string, cells: Array<{ fieldId: string; fieldName: string; text: string; rawValue?: unknown; type?: string; kind?: string }>) => ({
  id, source_sha256: 'a'.repeat(64), source_table_id: `table:${tableName}`, payload_sha256: 'b'.repeat(64),
  student_id: 'existing-student', lead_id: null, source_data: { format: 'feishu-base', filename: 'business.base' },
  record_data: { tableName, cells: cells.map(cell => ({ type: 'Text', kind: 'context', ...cell })) },
});
const record = (values: Record<string, string>, table = '获客&私域信息登记表1.0-总') => source('row', table,
  Object.entries(values).map(([fieldName, text], index) => ({ fieldId: `field-${index}`, fieldName, text })));

describe('Base business field organization', () => {
  it('keeps every nonempty field as a separate source fact without changing identities or the source', () => {
    const input = [record({ 获取日期: '20260129', 获客区位: '原地点', 触达内容: '第一行\n原文第二行', 获取人员: '原署名', 获客组别: '原组别' }),
      source('other-row', '到访数据与信息表1.0-总', [{ fieldId: 'one', fieldName: '家长情况', text: '第一份记录' }, { fieldId: 'two', fieldName: '家长情况2', text: '第二份记录' }])];
    const before = structuredClone(input);
    const plan = buildBaseBusinessPlan(input);
    const fields: BaseBusinessField[][] = plan.facts.map((fact: { fields: unknown }) => baseBusinessFieldsSchema.parse(fact.fields));
    expect(plan.summary).toMatchObject({ records: 2, definitions: 7, nonemptyText: 7, unmapped: 0 });
    expect(plan.facts[0]).toMatchObject({ source_record_id: 'row', source_payload_sha256: 'b'.repeat(64), mapping_version: 2 });
    expect(baseBusinessFieldsSchema.parse(plan.facts[0].fields)).toEqual(plan.facts[0].fields);
    expect(fields[0].find(field => field.key === 'acquired_on')).toMatchObject({ display: '2026-01-29', originalText: '20260129' });
    expect(fields[0].find(field => field.key === 'content')?.value).toBe('第一行\n原文第二行');
    expect(fields[1].map(field => field.value)).toEqual(['第一份记录', '第二份记录']);
    expect(plan.facts[1].fields[0].key).toBe(plan.facts[1].fields[1].key);
    expect(input).toEqual(before);
    expect(JSON.stringify(plan.fields)).not.toContain('原地点');
  });

  it.each([
    ['2024/2/29', { text: '2024-02-29', precision: 'day', year: 2024 }],
    ['2.29', { text: '02-29', precision: 'month_day', year: null }],
    ['一月', { precision: 'month', year: null, month: 1 }],
    ['202509', { text: '2025-09', precision: 'month', year: 2025 }],
    ['202512.27', { text: '2025-12-27', precision: 'day', year: 2025 }],
    ['2024-11-18 10:00 (Asia/Shanghai)', { text: '2024-11-18T10:00', precision: 'minute', zone: 'Asia/Shanghai' }],
    ['2025-12-08T21:00:02+08:00', { text: '2025-12-08T21:00:02+08:00', precision: 'second' }],
  ])('keeps date precision for %s', (text, expected) => {
    expect(parseBaseDate(text as string)).toMatchObject(expected);
  });

  it.each(['2025-02-29', '2026-13-10', '2026-01-01T24:00', '2026-01-01T12:61', '2026-01-01T12:00+15:00', '2026-01-01 12:00 (Unknown/Zone)', '姓名被填进日期', '11.1411，20'])('keeps invalid or mixed dates as original wording: %s', text => {
    expect(parseBaseDate(text)).toBeNull();
    expect(organizeBaseRecord(record({ 获取日期: text }))!.fields[0]).toMatchObject({ value: null, display: text, originalText: text, status: 'unparsed' });
  });

  it('keeps historical class labels, relative payment dates, monetary precision and non-renewal outcomes', () => {
    const fields = organizeBaseRecord(record({ 班型: '慎思', 缴费时间: '第1天', 缴费金额: '￥7,300.50', 续报与否: '新报（不用续报）', 是否续报: '已退费', 备考成绩: '未达A', '测评成绩（分数）': '50+' }))!.fields;
    const get = (key: string) => fields.find(field => field.name === key);
    expect(get('班型')?.value).toEqual({ label: '慎思', band: null });
    expect(get('缴费时间')?.value).toEqual({ text: '第1天', precision: 'relative_day', day: 1, anchor: null });
    expect(get('缴费金额')?.value).toEqual({ amount: '7300.50', currency: 'CNY' });
    expect(get('续报与否')?.value).toBe('new_enrollment');
    expect(get('是否续报')?.value).toBe('refunded');
    expect(get('备考成绩')).toMatchObject({ value: { band: 'x_plus', score: null, maxScore: null }, originalText: '未达A', display: 'X+' });
    expect(get('测评成绩（分数）')?.value).toEqual({ minimum: 50, exact: false });
  });

  it('preserves zero, raw option references and unknown fields while excluding empty and system fields', () => {
    const plan = buildBaseBusinessPlan([source('row', '到访数据与信息表1.0-总', [
      { fieldId: 'zero', fieldName: '缴费金额', text: '', rawValue: 0, type: 'Currency' },
      { fieldId: 'deleted-option', fieldName: '年级/25级', text: '', rawValue: 'source-option-without-label', type: 'SingleSelect' },
      { fieldId: 'future', fieldName: '以后新增字段', text: '保留原值' },
      { fieldId: 'empty', fieldName: '获取日期', text: '', rawValue: null },
      { fieldId: 'system', fieldName: '系统时间', text: '2026-09-10', kind: 'system' },
    ])]);
    expect(plan.summary).toMatchObject({ definitions: 4, cells: 4, nonemptyText: 1, rawOnly: 2, normalized: 1, reference: 1, unmapped: 1 });
    expect(plan.facts[0].fields).toHaveLength(3);
    expect(plan.facts[0].fields[0]).toMatchObject({ value: { amount: '0.00', currency: 'CNY' }, originalText: '' });
    expect(plan.facts[0].fields[1]).toMatchObject({ value: { sourceValue: 'source-option-without-label' }, status: 'reference' });
    expect(plan.facts[0].fields[2]).toMatchObject({ originalText: '保留原值', status: 'unmapped' });
  });

  it('keeps several phone numbers separate and never treats group members as student identity', () => {
    const fields = organizeBaseRecord(record({ 家长电话: '+86 138-0000-1234、0086 13900001234', 团成员手机号: '13700001234', 获取人员: '某老师' }))!.fields;
    expect(fields[0]).toMatchObject({ section: 'identity', key: 'parent_phone', value: ['13800001234', '13900001234'] });
    expect(fields[1]).toMatchObject({ section: 'acquisition', key: 'group_member_phone', value: ['13700001234'] });
    expect(fields[2]).toMatchObject({ section: 'acquisition', key: 'promoter', value: '某老师', kind: 'label' });
    expect(organizeBaseRecord({ ...record({ 获取日期: '2026-01-01' }), source_data: { format: 'xlsx', filename: 'reference.xlsx' } })).toBeNull();
  });
});

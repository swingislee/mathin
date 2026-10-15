import { describe, expect, it } from 'vitest';
import { sourceContactDating, sourceContactDay, sourceDay, sourceMonth, sourceRegisteredAt, sourceRegisteredOn } from '../scripts/lib/source-day.mjs';
import { buildSourceMetricFacts } from '../scripts/lib/source-metric-facts.mjs';
import { buildOperationalSourceImport } from '../scripts/lib/operational-source-import.mjs';

const registeredAt = (day: string) => Math.floor(Date.parse(`${day}T10:00:00+08:00`) / 1000);
const metadata = (day: string) => ({ fieldId: '__record_metadata', fieldName: '来源记录元数据', type: 'SourceMetadata', kind: 'system',
  text: JSON.stringify({ recMeta: { createdTime: registeredAt(day) } }), rawValue: { recMeta: { createdTime: registeredAt(day) } } });
const acquisitionRow = (registered: string, values: Record<string, string>) => ({
  id: 'source', source_table_id: 'export:tblzwPK2XgJa14EC', source_record_id: 'row',
  source_data: { format: 'feishu-base', filename: '2026-10-14【思维】用户与产品运营表.base' },
  record_data: { tableName: '获客&私域信息登记表1.0-总', names: ['来源学员'], phones: ['12345678901'],
    cells: [...Object.entries(values).map(([fieldName, text], index) => ({ fieldId: `field-${index}`, fieldName, text, kind: 'context' })), metadata(registered)] },
});

describe('来源日期按登记顺序补年', () => {
  it('登记日取飞书记录创建时间的上海日期', () => {
    expect(sourceRegisteredOn({ cells: [metadata('2025-12-19')] })).toBe('2025-12-19');
    expect(sourceRegisteredOn({ cells: [{ ...metadata('2026-10-11'), rawValue: undefined }] })).toBe('2026-10-11');
    expect(sourceRegisteredOn({ cells: [] })).toBeNull();
    expect(sourceRegisteredAt({ cells: [metadata('2025-12-19')] })).toBe('2025-12-19T02:00:00.000Z');
  });

  it('写全年月日的原样采用，月日写法取离登记日最近的年份且不晚于导出日', () => {
    expect(sourceDay('2025/12/19', {})).toEqual({ day: '2025-12-19', basis: 'explicit' });
    expect(sourceDay('2026-10-10 15:50:21', {})).toEqual({ day: '2026-10-10', basis: 'explicit' });
    expect(sourceDay('10.11', { registeredOn: '2026-10-11', notAfter: '2026-10-14' })).toEqual({ day: '2026-10-11', basis: 'registration_order' });
    expect(sourceDay('10/10', { registeredOn: '2026-10-11', notAfter: '2026-10-14' })?.day).toBe('2026-10-10');
    expect(sourceDay('12.22', { registeredOn: '2026-01-08', notAfter: '2026-10-14' })?.day).toBe('2025-12-22');
    expect(sourceDay('7.29', { registeredOn: '2025-12-12', notAfter: '2026-10-14' })?.day).toBe('2025-07-29');
    expect(sourceDay("12.10'", { registeredOn: '2025-12-12', notAfter: '2026-10-14' })?.day).toBe('2025-12-10');
    expect(sourceDay('10.9', {})).toBeNull();
    expect(sourceDay('2.30', { registeredOn: '2026-02-01' })).toBeNull();
  });

  it('确认日期不早于同行获取日期，找不到合理年份时不补', () => {
    const read = (values: Record<string, string>) => (name: string) => values[name] ?? '';
    expect(sourceContactDay(read({ 获取日期: '2026.1.17', 确认日期: '9.26' }), 'confirmation', { registeredOn: '2026-01-20', notAfter: '2026-10-14' })?.day).toBe('2026-09-26');
    expect(sourceContactDay(read({ 获取日期: '2026-10-10', 确认日期: '10.20' }), 'confirmation', { registeredOn: '2026-10-11', notAfter: '2026-10-14' })).toBeNull();
  });

  it('推断与疑点写入数据：补年、只记月份、离登记过远、月份栏不一致、原文不是日期', () => {
    const read = (values: Record<string, string>) => (name: string) => values[name] ?? '';
    const bounds = { registeredOn: '2026-04-29', notAfter: '2026-10-14' };
    expect(sourceContactDating(read({ 获取日期: '4.29', 确认日期: '5.2', 确认月份: '5月' }), 'confirmation', bounds)).toEqual({ label: '5.2', day: '2026-05-02', basis: 'registration_order', review: null });
    expect(sourceContactDating(read({ 获取日期: '4.29', 确认日期: '8.5', 确认月份: '4月' }), 'confirmation', bounds)).toMatchObject({ day: '2026-08-05', review: 'far_from_registration' });
    expect(sourceContactDating(read({ 获取日期: '4.29', 确认日期: '5.20', 确认月份: '4月' }), 'confirmation', bounds)).toMatchObject({ day: '2026-05-20', review: 'month_conflict' });
    expect(sourceContactDating(read({ 确认日期: '一月' }), 'confirmation', bounds)).toMatchObject({ day: null, basis: 'month_only', review: null });
    expect(sourceContactDating(read({ 确认日期: '9，20' }), 'confirmation', bounds)).toMatchObject({ day: null, basis: null, review: 'unparsed' });
    expect(sourceContactDating(read({ 跟进日期: '2026/07/10', 跟进月份: '7月' }), 'followup', bounds)).toEqual({ label: '2026/07/10', day: '2026-07-10', basis: 'explicit', review: null });
    expect(sourceContactDating(read({}), 'confirmation', bounds)).toEqual({ label: null, day: null, basis: null, review: null });
  });

  it('只写月份的同样按登记顺序取年份', () => {
    expect(sourceMonth('一月', { registeredOn: '2026-01-05', notAfter: '2026-10-14' })).toBe('2026-01');
    expect(sourceMonth('12月', { registeredOn: '2026-01-05', notAfter: '2026-10-14' })).toBe('2025-12');
    expect(sourceMonth('2025年10月', {})).toBe('2025-10');
    expect(sourceMonth('9.5', { registeredOn: '2026-01-05' })).toBeNull();
  });

  it('导入写入补全的联系日期，统计月份与之一致', () => {
    const row = acquisitionRow('2025-08-02', { 获取日期: '7.20', 确认日期: '7.29', 确认结果: '已沟通', 确认人员: '学服甲', 确认信息备注: '妈妈说孩子暑假在外地' });
    expect(buildSourceMetricFacts(row)).toMatchObject({ communicationDate: '7.29', dateBasis: 'registration_order', months: { contacts: '2025-07' } });
    expect(buildSourceMetricFacts(row)).not.toHaveProperty('dateReview');
    const plan = buildOperationalSourceImport({ records: [row], payloadHash: 'test', batchKey: 'test' }, {});
    expect(plan.rows.lead_communications.find(contact => String(contact.source_key).endsWith(':confirmation')))
      .toMatchObject({ occurred_on: '2025-07-29', source_metric_facts: { months: { contacts: '2025-07' } } });
  });
});

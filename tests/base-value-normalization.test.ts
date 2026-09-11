import { describe, expect, it } from 'vitest';
import { organizeBaseRecord } from '../scripts/lib/base-business-fields.mjs';
import { auditBaseBusinessValues } from '../scripts/lib/base-business-values-audit.mjs';
import { baseBusinessFieldsSchema } from '../src/features/school/base-business-fields-schema.mjs';

function field(name: string, text: string) {
  const source = { id: 'source', payload_sha256: 'a'.repeat(64), source_data: { format: 'feishu-base' },
    record_data: { tableName: 'sample', cells: [{ fieldId: 'field', fieldName: name, text, type: 'Text' }] } };
  const result = organizeBaseRecord(source)!;
  expect(baseBusinessFieldsSchema.parse(result.fields)).toEqual(result.fields);
  expect(result.fields[0].originalText).toBe(text);
  return result.fields[0];
}

describe('Base values are normalized within their business meaning', () => {
  it.each(['一', '一年级', '1', '1年级', '小学一', '小一', '小学一年级', '第一年级', '１ 年级', '一年级年级'])('maps %s to one numeric grade while retaining its source', text => {
    expect(field('年级/25级', text)).toMatchObject({ value: 1, display: '1年级', status: 'normalized' });
  });
  it('keeps school stages, historical transitions and several children distinct', () => {
    expect(field('年级', '初一').value).toBe(7);
    expect(field('年级', '初中二年级').value).toBe(8);
    expect(field('年级', '大')).toMatchObject({ display: '大班', value: { stage: 'kindergarten', level: 'senior' } });
    expect(field('年级', '二升三 年级')).toMatchObject({ value: 3, display: '3年级' });
    expect(field('年级', '一年级 四年级')).toMatchObject({ value: { children: [{ index: 1, grade: 1 }, { index: 2, grade: 4 }], identityStatus: 'structured' }, review: [] });
    expect(field('年级', '五六年级年级')).toMatchObject({ value: 6, display: '6年级' });
    expect(field('年级', '小区北门')).toMatchObject({ value: null, display: '小区北门' });
    expect(field('年级', '未知')).toMatchObject({ value: null, display: '资料待补', status: 'pending' });
  });
  it('normalizes the same boolean with field-specific labels and rejects unrelated positive words', () => {
    for (const text of ['已到', '出勤', '已出勤', '是']) expect(field('到访与否', text)).toMatchObject({ value: true, display: '已到访' });
    for (const text of ['报名', '已报', '已报名', '是']) expect(field('报名与否', text)).toMatchObject({ value: true, display: '已报名' });
    for (const text of ['是', '已领取', '已领']) expect(field('真题领取', text)).toMatchObject({ value: true, display: '已领取' });
    expect(field('用户当下加V与否', '已报名')).toMatchObject({ value: null, status: 'unparsed' });
    expect(field('是否续报', '新报')).toMatchObject({ value: 'new_enrollment', display: '新报（无需续报）' });
    expect(field('是否续报', '已退款')).toMatchObject({ value: 'refunded' });
    expect(field('是否续报', '未续')).toMatchObject({ value: 'not_renewed' });
  });
  it('normalizes groups, class order, month and week without confusing a weekday with a week number', () => {
    expect(field('获客组别', '一组').value).toEqual(field('获客组别', '1组').value);
    expect(field('组别', '职能').value).toBe('职能');
    expect(field('老师班序（暂按周内时间先后）', '班2').value).toEqual(field('单师班序（仅多维统计用）', '2班').value);
    expect(field('获取月份', '三月')).toMatchObject({ value: { unit: 'month', month: 3, year: null }, display: '3月' });
    expect(field('获取周次', '第一周')).toMatchObject({ value: { unit: 'week_ordinal', week: 1 } });
    expect(field('周次', '星期一')).toMatchObject({ value: { unit: 'weekday', day: 1 } });
    expect(field('周次', '9月1周')).toMatchObject({ value: { unit: 'month_week', month: 9, week: 1, year: null } });
    expect(field('报名季节', '寒').value).toEqual(field('报名季节', '寒假').value);
  });
  it.each(['10：00', '10；00', '10:00', '10.00', '上午10点', '10；0 0'])('normalizes clock punctuation in %s', text => {
    expect(field('到访时段', text)).toMatchObject({ display: '10:00', value: { time: '10:00', clock: '24h' } });
  });
  it('uses confirmed business hours, preserves explicit periods and validates minutes', () => {
    expect(field('到访时段', '下午3点半')).toMatchObject({ display: '15:30', value: { time: '15:30', clock: '24h' } });
    expect(field('到访时段', '3：30')).toMatchObject({ display: '15:30', value: { time: '15:30', clock: '24h' } });
    expect(field('上课开始时间', '9：00-11：30')).toMatchObject({ display: '09:00–11:30', value: { time: '09:00', endTime: '11:30' } });
    expect(field('上课开始时间', '下午3:00-5:00')).toMatchObject({ display: '15:00–17:00', value: { time: '15:00', endTime: '17:00', clock: '24h' } });
    expect(field('到访时段', '晚上12点')).toMatchObject({ display: '00:00' });
    expect(field('到访时段', '10:80')).toMatchObject({ status: 'unparsed' });
    expect(field('到访时段', '9:30后')).toMatchObject({ display: '09:30后', value: { time: '09:30', relation: 'after' }, status: 'normalized' });
  });
  it('unifies exact channel aliases while preserving named people, school distinctions and payment methods', () => {
    expect(field('获取渠道', '家长介绍').value).toBe(field('渠道', '家长推荐').value);
    expect(field('获取渠道', '地堆').display).toBe('地推');
    expect(field('获取渠道', '老师介绍').display).toBe('老师转介绍');
    expect(field('获取渠道', '某老师介绍').value).toBe('某老师介绍');
    expect(field('就读学校', '实验一小').value).toBe('实验一小');
    expect(field('就读学校', '四十六中南').value).toEqual(field('就读学校', '46中南').value);
    expect(field('就读学校', '贵阳路三小').value).toEqual(field('就读学校', '三小贵阳路').value);
    expect(field('就读学校', '三小南京路').value).not.toEqual(field('就读学校', '三小贵阳路').value);
    expect(field('就读学校', '数独')).toMatchObject({ section: 'followup', key: 'interest_content', value: ['数独'] });
    expect(field('缴费方式', '微信支付').value).toBe('微信');
    expect(field('缴费方式', '魔法校H5').value).not.toEqual(field('缴费方式', '魔法校二维码').value);
  });
  it('compares multi-select sets and follows the confirmed positive WeChat result', () => {
    expect(field('参与内容', '测评、体验课、测评').value).toEqual(field('参与内容', '体验课，测评').value);
    expect(field('参与内容', '散测').value).not.toEqual(field('参与内容', '测评').value);
    expect(field('确认结果', '诺访、加V').value).toEqual(field('确认结果', '加V、诺访').value);
    expect(field('获客加V情况', '未加V与群、已加V')).toMatchObject({ value: ['已加微信'] });
  });
  it('keeps grade bands, class labels, rating scales and original link references meaningful', () => {
    expect(field('思维测评等级', 'ａ＋')).toMatchObject({ value: 'a_plus', display: 'A+' });
    expect(field('思维测评等级', 'A').value).not.toBe(field('思维测评等级', 'A+').value);
    expect(field('学员程度&推荐班型', '未达A')).toMatchObject({ value: { band: 'x_plus', label: 'X+' } });
    expect(field('班型', '慎思—')).toMatchObject({ value: { label: 'A', band: 'a' } });
    expect(field('意向分类', 'A').value).toEqual(field('体系兴趣度', '高').value);
    expect(field('意向分类', 'B').value).toEqual(field('体系兴趣度', '中').value);
    expect(field('意向分类', 'C').value).toEqual(field('体系兴趣度', '低').value);
    expect(field('第3天', 'recv4NnhBdHKJG')).toMatchObject({ status: 'pending', display: '资料待补', value: { sourceRecordId: 'recv4NnhBdHKJG' } });
  });
  it('keeps source date precision, currency precision and season-specific renewal results', () => {
    expect(field('获取日期', '一月').value).toEqual(field('获取日期', '1月').value);
    expect(field('获取日期', '6月10日').value).not.toEqual(field('获取日期', '2026年6月10日').value);
    for (const text of ['人民币7,300.50元', 'RMB7300.50', '0.73005万元', '7.3005千元']) expect(field('缴费金额', text).value).toEqual({ amount: '7300.50', currency: 'CNY' });
    expect(field('缴费金额', 'USD 100')).toMatchObject({ value: null, status: 'unparsed' });
    expect(field('缴费时间', '第一天').value).toEqual(field('缴费时间', '第1天').value);
    expect(field('续报与近期新报情况', '续寒未续春')).toMatchObject({ value: { winter: 'renewed', spring: 'not_renewed' } });
    expect(field('续报与近期新报情况', '新报寒（未报春）')).toMatchObject({ value: { winter: 'new_enrollment', spring: 'not_enrolled' } });
  });
  it('audits actual value changes, alias groups and unresolved source issues without altering sources', () => {
    const originals = [field('年级', '一'), field('年级', '一年级'), field('年级', '年级待问')];
    const facts = originals.map((value, index) => ({ source_record_id: String(index), fields: [value] }));
    const before = facts.map(fact => ({ ...fact, fields: fact.fields.map(value => ({ ...value, value: value.originalText, display: value.originalText })) }));
    const audit = auditBaseBusinessValues(before, facts);
    expect(audit.summary).toMatchObject({ records: 3, values: 3, changedValues: 3, changedDisplays: 2, synonymGroups: 1, reviewValues: 1 });
    expect(audit.fields[0].aliases[0].originals).toEqual([{ text: '一', count: 1 }, { text: '一年级', count: 1 }]);
    expect(audit.issues[0]).toMatchObject({ sourceId: '2', originalText: '年级待问', reasons: ['ambiguous'] });
    const sameValue = field('获取日期', '2026-01-02');
    const reorderedValue = { ...sameValue, value: Object.fromEntries(Object.entries(sameValue.value as object).reverse()) };
    expect(auditBaseBusinessValues([{ source_record_id: 'same', fields: [reorderedValue] }], [{ source_record_id: 'same', fields: [sameValue] }]).summary.changedValues).toBe(0);
  });
});

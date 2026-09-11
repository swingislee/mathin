import { describe, expect, it } from 'vitest';
import { organizeBaseRecord, parseBaseDate } from '../scripts/lib/base-business-fields.mjs';
import { baseBusinessFieldsSchema } from '../src/features/school/base-business-fields-schema.mjs';
import { auditBaseBusinessValues } from '../scripts/lib/base-business-values-audit.mjs';

function field(name: string, text: string) {
  const source = { id: 'source', payload_sha256: 'a'.repeat(64), source_data: { format: 'feishu-base' },
    record_data: { tableName: 'sample', cells: [{ fieldId: 'cell', fieldName: name, text, type: 'Text' }] } };
  const result = organizeBaseRecord(source)!;
  expect(baseBusinessFieldsSchema.parse(result.fields)).toEqual(result.fields);
  expect(result.fields).toHaveLength(1);
  expect(result.fields[0]).toMatchObject({ name, originalText: text, fieldId: 'cell' });
  return result.fields[0];
}

describe('confirmed Base review decisions keep the original cell and route its meaning', () => {
  it.each([['三奶奶及', 3], ['嗣年极', 4], ['一升年级', 2], ['二？年级', 2], ['&#x20;二升三', 3], ['七年升八级', 8]])('corrects %s to %s without adding a school year', (text, grade) => {
    expect(field('年级/25级', String(text))).toMatchObject({ value: grade, display: `${grade}年级`, status: 'normalized' });
    expect(field('年级/25级', String(text)).review).toBeUndefined();
  });
  it('uses the destination of kindergarten transitions too', () => {
    expect(field('年级', '大升一年级').value).toBe(1);
    expect(field('年级', '小班升中班')).toMatchObject({ display: '中班', value: { stage: 'kindergarten', level: 'middle' } });
  });
  it('keeps two children distinct until names and family links can be confirmed', () => {
    const result = field('年级/25级', '&#x20;一年级 中班');
    expect(result).toMatchObject({ review: [], display: '孩子1（姓名：资料待补）：1年级\n孩子2（姓名：资料待补）：中班', value: {
      identityStatus: 'structured', children: [{ index: 1, name: null, nameStatus: 'information_pending', grade: 1 }, { index: 2, name: null, grade: { stage: 'kindergarten', level: 'middle' } }],
    } });
    expect(result.value).not.toHaveProperty('studentId');
    expect(field('年级', '五六年级年级')).toMatchObject({ value: 6, display: '6年级' });
  });
  it('corrects the date quote and keeps multiple explicit dates without inventing a year', () => {
    expect(field('确认日期', "12.10'")).toMatchObject({ value: { text: '12-10', year: null, precision: 'month_day' } });
    expect(field('确认日期', '11.12 11.13')).toMatchObject({ value: { precision: 'multiple_dates', dates: [{ text: '11-12' }, { text: '11-13' }] } });
    expect(parseBaseDate("2.30'")).toBeNull();
    expect(field('确认日期', '11.1411，20')).toMatchObject({ display: '11-14、11-20', value: { precision: 'multiple_dates', dates: [{ text: '11-14', year: null }, { text: '11-20', year: null }] } });
  });
  it('uses afternoon business hours while respecting explicit mornings', () => {
    expect(field('到访时段', '3:00')).toMatchObject({ value: { time: '15:00' }, display: '15:00' });
    expect(field('上课开始时间', '1:30–3:00')).toMatchObject({ value: { time: '13:30', endTime: '15:00' } });
    expect(field('到访时段', '凌晨3:00')).toMatchObject({ value: { time: '03:00' } });
    expect(field('到访时段', '上午3:00')).toMatchObject({ value: { time: '03:00' } });
    expect(field('到访时段', '9:30后')).toMatchObject({ value: { relation: 'after' } });
  });
  it.each(['中海广场', '方圆荟', '万年埠附近'])('keeps %s as a nearby place without inferring the acquisition address', text => {
    expect(field('就读学校', text)).toMatchObject({ section: 'identity', key: 'nearby_location', label: '附近地点', value: text });
  });
  it.each(['包河区合肥市师范附属小学-北门', '包河区云南路东侧临时停车点', '包河区滨湖顺园南区-西门', '水晶公馆',
    '包河区控优点眼镜销售店', '包河区合肥师范附小四小-南门', '包河区新东方素质成长中心(贵州路店)', '包河区杭川公园(杭州路)'])('routes %s to acquisition', text => {
    expect(field('年级/25级', text)).toMatchObject({ section: 'acquisition', key: 'location', label: '获取地址', value: text });
  });
  it('splits school/location and grade while retaining a single source cell', () => {
    const school = field('就读学校', '| 合肥师范附小四小(四川路) / 一年级');
    expect(school).toMatchObject({ section: 'identity', key: 'school', value: '合肥师范附小四小(四川路)',
      projections: [{ section: 'identity', key: 'grade', value: 1, display: '1年级' }] });
    const place = field('就读学校', '包河区保利·和盛公馆(四川路)\n三年级');
    expect(place).toMatchObject({ section: 'acquisition', key: 'location', projections: [{ section: 'identity', key: 'grade', value: 3 }] });
    expect(field('就读学校', '中班')).toMatchObject({ key: 'grade', display: '中班' });
  });
  it('keeps a historical employee mention out of the date and account model', () => {
    const result = field('确认日期', '@历史老师 (https://example.test/avatar.png)');
    expect(result).toMatchObject({ section: 'confirmation', key: 'staff', label: '历史职员', value: { name: '历史老师', historical: true }, display: '历史老师' });
    expect(result.value).not.toHaveProperty('userId');
  });
  it('moves source labels and preserves their season qualification', () => {
    expect(field('就读学校', '金子塔老生秋季')).toMatchObject({ section: 'acquisition', key: 'channel', value: { source: '金字塔老生', season: 'autumn' } });
    expect(field('就读学校', '金子塔老生')).toMatchObject({ section: 'acquisition', key: 'channel', value: { source: '金字塔老生', season: null } });
  });
  it.each(['《举一反三》公开课', '《举一反三》训练营', '数独', '思维闯关', '数独-1对1测评分析'])('moves %s into interests, separate from the ABC interest rating', text => {
    expect(field('就读学校', text)).toMatchObject({ section: 'followup', key: 'interest_content', display: text });
  });
  it('handles misplaced interest notes, other information and remarks', () => {
    expect(field('学期情况', '特别匹配问题')).toMatchObject({ section: 'followup', key: 'interest_content' });
    expect(field('年级', '小宝')).toMatchObject({ section: 'reference', key: 'other', display: '小宝' });
    expect(field('就读学校', '知道金字塔，8月约体验，暑假7约时间不行，思维目前不考虑。')).toMatchObject({ section: 'notes', key: 'note' });
  });
  it('keeps positive WeChat evidence and the next communication action together', () => {
    expect(field('确认结果', '暂无结果、加V')).toMatchObject({ value: ['已加微信', '待下次沟通'] });
    expect(field('确认结果', '未通、暂无结果')).toMatchObject({ value: ['未接通', '待下次沟通'] });
    expect(field('获客加V情况', '未加V与群、已加V')).toMatchObject({ value: ['已加微信'] });
    expect(field('获客加V情况', '未加V与群、已加V').review).toBeUndefined();
    expect(field('确认结果', '暂无结果、加V').review).toBeUndefined();
    expect(field('获客加V情况', '未加V与群')).toMatchObject({ value: ['未加微信及群'] });
    expect(field('班型', '慎思—')).toMatchObject({ value: { label: 'A', band: 'a' }, display: 'A' });
  });
  it('counts completed classification separately from the names to be completed later', () => {
    const fields = [field('就读学校', '水晶公馆'), field('年级', '一年级 中班'), field('就读学校', '合肥师范附小四小(四川路)\n一年级')];
    const facts = fields.map((value, index) => ({ source_record_id: String(index), fields: [value] }));
    const previous = facts.map(fact => ({ ...fact, fields: fact.fields.map(value => ({ ...value, section: 'identity', key: value.name === '年级' ? 'grade' : 'school',
      projections: undefined, label: undefined, value: null, display: value.originalText, status: 'unparsed', review: ['ambiguous'] })) }));
    expect(auditBaseBusinessValues(previous, facts).summary).toMatchObject({ priorReviewValues: 3, resolvedReviewValues: 3, reviewValues: 0,
      reclassifiedValues: 1, projectedValues: 1, changedValues: 3 });
  });
  it('marks missing source values as details to complete during import', () => {
    for (const [name, text] of [['就读学校', '未知'], ['年级', '未知'], ['到访时段', ';'], ['家长手机号', '1']]) {
      const result = field(name, text);
      expect(result).toMatchObject({ status: 'pending', display: '资料待补' });
      expect(result.review).toBeUndefined();
    }
  });
});

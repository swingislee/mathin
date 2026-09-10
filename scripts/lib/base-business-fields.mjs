import { normalizeSourceAssessmentBand, sourceScore } from '../../src/features/school/business-source-contract.ts';
import { normalizeGradeLabel } from '../../src/lib/grade-format.mjs';
import { normalizeBaseSemanticValue } from './base-value-normalization.mjs';

export const BASE_FIELD_VERSION = 2;

// 字段名只用于选择语义；每个来源字段 ID 和原值分别保存，不把同名字段合并。
const definitions = new Map();
function define(section, key, kind, names) {
  for (const name of names.split('|')) {
    if (definitions.has(name)) throw new Error(`BASE_FIELD_DUPLICATE_DEFINITION: ${name}`);
    definitions.set(name, { section, key, kind });
  }
}

define('identity', 'name', 'text', '姓名|学员姓名');
define('identity', 'phone', 'phone', '电话|手机号|手机号码|联系方式');
define('identity', 'parent_phone', 'phone', '家长电话|家长手机号');
define('identity', 'gender', 'gender', '性别|学员性别');
define('identity', 'school', 'text', '就读学校|就读小学');
define('identity', 'grade', 'grade', '年级');
define('identity', 'grade_2025', 'grade', '年级/25级');
define('identity', 'spring_grade', 'grade', '春季年级');
define('identity', 'education_stage', 'choice', '学段|用户学段');
define('identity', 'birth_date', 'date', '出生日期');
define('identity', 'document_number', 'text', '证件号码');
define('identity', 'email', 'text', '邮箱');
define('identity', 'source_student_id', 'text', '学员ID');
define('identity', 'student_type', 'choice', '学员类型');

define('acquisition', 'acquired_on', 'date', '获取日期|获取时间|提交日期|提交时间');
define('acquisition', 'month', 'period', '获取月份');
define('acquisition', 'week', 'period', '获取周次');
define('acquisition', 'group', 'label', '获客组别');
define('acquisition', 'location', 'text', '获客区位');
define('acquisition', 'channel', 'choice', '获取渠道|渠道|学生来源渠道');
define('acquisition', 'promoter', 'label', '获取人员');
define('acquisition', 'content', 'text', '触达内容');
define('acquisition', 'wechat_status', 'multi', '获客加V情况');
define('acquisition', 'group_buy_started', 'boolean', '开团与否');
define('acquisition', 'group_member_phone', 'phone', '团成员手机号');
define('acquisition', 'group_buy_contact', 'boolean', '真题拼团沟通');
define('acquisition', 'materials_received', 'boolean', '真题领取');

define('followup', 'occurred_on', 'date', '跟进日期|沟通日期');
define('followup', 'month', 'period', '跟进月份');
define('followup', 'week', 'period', '跟进周次');
define('followup', 'group', 'label', '跟进组别');
define('followup', 'staff', 'label', '跟进人|沟通人员');
define('followup', 'result', 'choice', '跟进结果');
define('followup', 'note', 'text', '跟进信息|沟通情况|初步信息（首轮）');
define('followup', 'channel', 'choice', '沟通方式');
define('followup', 'current_status', 'multi', '当下状态');
define('followup', 'wechat_added', 'boolean', '用户当下加V与否');
define('followup', 'support_wechat_added', 'boolean', '加V与否（学服）');
define('followup', 'teacher_wechat_added', 'boolean', '加V与否（老师）');
define('followup', 'visit_committed', 'boolean', '诺访与否');
define('followup', 'interest', 'choice', '意向分类|体系兴趣度');
define('followup', 'english_contacted', 'boolean', '是否沟通英语');

define('confirmation', 'occurred_on', 'date', '确认日期');
define('confirmation', 'month', 'period', '确认月份');
define('confirmation', 'week', 'period', '确认周次');
define('confirmation', 'group', 'label', '确认组别');
define('confirmation', 'staff', 'label', '确认人员');
define('confirmation', 'result', 'multi', '确认结果');
define('confirmation', 'note', 'text', '确认信息备注');

define('visit', 'occurred_on', 'date', '到访日期|参加选拔产品日期');
define('visit', 'month', 'period', '到访月份');
define('visit', 'week', 'period', '到访周次');
define('visit', 'group', 'label', '到访组别|选拔交付组别');
define('visit', 'time_slot', 'text', '到访时段|时间段');
define('visit', 'attended', 'boolean', '到访与否|学员出勤情况');
define('visit', 'parent_attendance', 'choice', '家长出勤情况');
define('visit', 'content', 'multi', '参与内容|选拔产品项目');
define('visit', 'product', 'choice', '选拔产品|专题产品');
define('visit', 'registered_on', 'date', '报名选拔产品日期');
define('visit', 'trial_after_assessment', 'boolean', '散测后试听与否');
define('visit', 'parent_trial_attended', 'boolean', '家长体验课旁听');
define('visit', 'parent_orientation_attended', 'boolean', '家长说明会参与情况');
define('visit', 'plan_presented', 'boolean', '方案宣讲与否');

define('assessment', 'occurred_on', 'date', '体/测日期');
define('assessment', 'math_band', 'band', '思维测评等级');
define('assessment', 'learning_band', 'band', '学习力测评等级');
define('assessment', 'score', 'score_or_band', '测评成绩（分数）');
define('assessment', 'english_score', 'choice', '英语测评成绩（年级限定下）');
define('assessment', 'preparation_result', 'score_or_band', '备考成绩');
define('assessment', 'preparation_status', 'choice', '备考情况');
define('assessment', 'english_assessed', 'boolean', '是否体验/测评英语');
define('assessment', 'student_background', 'text', '学员情况|学员情况2');
define('assessment', 'family_background', 'text', '家长情况|家长情况2');
define('assessment', 'parent_approach', 'choice', '家长理念');
define('assessment', 'parent_concerns', 'text', '体验测评家长关注点|家长主要关注点|家长报名重视点总结');
define('assessment', 'shared_expectations', 'text', '培养重点&核心期待&共识点');
define('assessment', 'recommended_class', 'class_band', '学员程度&推荐班型');
define('assessment', 'parent_summary', 'text', '家长沟通信息总结（附整理文档）');
define('assessment', 'scenario_document', 'text', '单人情景再现文档链接');
define('assessment', 'report_files', 'attachment', '测评报告附件');

define('enrollment', 'registered_on', 'date', '报名日期|报名缴费日期|报名体系日期');
define('enrollment', 'month', 'period', '报名月份');
define('enrollment', 'week', 'period', '报名周次');
define('enrollment', 'confirmed', 'boolean', '报名与否|报名体系与否');
define('enrollment', 'autumn_2026_active', 'boolean', '26秋在读');
define('enrollment', 'autumn_2026_mode', 'choice', '26秋报名模式');
define('enrollment', 'class_band', 'class_band', '班型');
define('enrollment', 'spring_class_band', 'class_band', '春季班型');
define('enrollment', 'class', 'label', '班级|所在班级|班级名称');
define('enrollment', 'campus', 'label', '校区');
define('enrollment', 'term', 'period', '学期|学期情况|报名季节');
define('enrollment', 'english_confirmed', 'boolean', '是否报名英语');
define('enrollment', 'english_registered_on', 'date', '英语报名日期');

define('support', 'staff', 'label', '学服老师|主线服务老师|报名服务老师|非在读-学服|配合跟进学服老师');
define('support', 'teacher', 'label', '学科老师|授课学科老师|授课老师|带课老师|授课教师|思维在读-老师');
define('support', 'other_teacher', 'label', '其他老师');
define('support', 'group', 'label', '组别|配合学服组别');
define('support', 'area', 'label', '管区');

define('renewal', 'status', 'renewal_status', '续报与否|是否续报');
define('renewal', 'type', 'choice', '续报类型');
define('renewal', 'recent_status', 'choice', '续报与近期新报情况');
define('renewal', 'price_campaign_result', 'choice', '调价运营结果');
define('renewal', 'price_campaign_subject', 'boolean', '是否列入调价运营对象（临时字段）');
define('renewal', 'price_campaign_note', 'text', '调价运营用户情况');
define('renewal', 'late_registered_on', 'date', '补续日期');
define('renewal', 'parent_note', 'text', '续&未报家长情况说明|未报/连报情况');
define('renewal', 'support_note', 'text', '用户运营情况（学服老师填写项）');
define('renewal', 'teacher_note', 'text', '用户沟通情况（授课老师填写项）');
define('renewal', 'special_note', 'text', '特别备注说明');
define('renewal', 'scholarship_delivery', 'multi', '奖学券推送情况');
define('renewal', 'scholarship_sent_on', 'date', '推送日期');

define('finance', 'paid_on', 'date_or_relative', '缴费时间');
define('finance', 'amount', 'money', '缴费金额');
define('finance', 'payment_method', 'choice', '缴费方式|缴费通道');

define('teaching', 'week', 'period', '周次|周类|26秋上课周次|所在周次');
define('teaching', 'time_slot', 'text', '上课开始时间|26秋上课时段');
define('teaching', 'class_time', 'date_or_time', '上课时间');
define('teaching', 'year', 'period', '年度');
define('teaching', 'month', 'period', '所在月份');
define('teaching', 'lecture', 'choice', '讲次|第一讲次');
define('teaching', 'lecture_name', 'text', '讲次名称');
define('teaching', 'knowledge_module', 'choice', '讲次知识模块');
define('teaching', 'class_order', 'choice', '单师班序（仅多维统计用）|老师班序（暂按周内时间先后）');
define('teaching', 'entry_score', 'score', '进门测得分');
define('teaching', 'entry_error_type', 'choice', '进门测错误类型');
define('teaching', 'error_type', 'choice', '错题类型');
define('teaching', 'error_question', 'choice', '错题预号');
define('teaching', 'preparation', 'choice', '预习评价');
define('teaching', 'handwriting', 'choice', '本周书写');
define('teaching', 'extension_note', 'text', '拓展情况');
define('teaching', 'practice_note', 'text', '加油站情况');
define('teaching', 'makeup_note', 'text', '补调情况');
define('teaching', 'attendance_note', 'text', '出勤情况');
define('teaching', 'reschedule_or_leave', 'boolean', '调课请假与否');
define('teaching', 'weekly_calculation_note', 'text', '计算周总结');
define('teaching', 'practice_files', 'attachment', '打卡附件');
for (let day = 1; day <= 6; day++) define('teaching', `day_${day}`, 'choice', `第${day}天`);

define('competition', 'form_completed', 'boolean', '填写与否');
define('competition', 'level', 'choice', '竞赛级别');
define('competition', 'short_course', 'choice', '短期班');
define('competition', 'short_course_term', 'period', '短期班期次');
define('competition', 'practice_status', 'boolean', '备考打卡');
for (let index = 1; index <= 2; index++) define('competition', `lesson_${index}`, 'date', `短期班第${index}次课`);
for (let index = 1; index <= 9; index++) define('competition', `practice_${index}`, 'choice', `卡${index}`);

define('content', 'month', 'period', '月份');
define('content', 'service_type', 'multi', '服务类型');
define('content', 'dimensions', 'multi', '方案维度');
define('content', 'author', 'label', '产出老师');
define('content', 'published_on', 'date', '发布日期');
define('content', 'format', 'choice', '内容形态');
define('content', 'topic', 'text', '内容主题');
define('content', 'channels', 'multi', '发布渠道');
define('content', 'project', 'text', '项目');
define('content', 'communication_copy', 'text', '沟通基础文案');
define('resources', 'files', 'attachment', '附件|相关附件|题目附件|海报&PDF附件');
define('resources', 'description', 'text', '说明');
define('resources', 'category', 'choice', '类别');

define('operations', 'period', 'period', '周期');
define('operations', 'reported_on', 'date', '信息对应日期');
define('operations', 'reporter', 'label', '日报人');
define('operations', 'daily_note', 'text', '当日信息内容');
define('operations', 'suggestion', 'text', '解决思路建议');
define('operations', 'copied_staff', 'label', '抄送人');
define('operations', 'scenario', 'text', '运营场景');
define('operations', 'visit_commitment_target', 'number', '诺访目标');
define('operations', 'promoter_target', 'number', '有效兼职人数目标');
define('operations', 'confirmed_wechat_target', 'number', '有效获客目标(确认加V）');
define('operations', 'acquisition_target', 'number', '整体获客目标');
define('operations', 'enrollment_target', 'number', '报名目标');
define('operations', 'attendance_target', 'number', '到访目标');
define('operations', 'stall_target', 'number', '摆台点目标');
define('operations', 'direct_invitation_target', 'number', '精准获客目标（直邀诺访）');
define('operations', 'new_wechat_target', 'number', '新增私域目标（加V）');
define('operations', 'channel_target', 'number', '渠道数目标');
define('operations', 'social_account_target', 'number', '小红书账号数目标');
define('operations', 'support_resources', 'number', '学服资源数');
define('notes', 'note', 'text', '备注');
define('reference', 'parent_record', 'reference', '父记录');
// 空白模板字段继续占有明确去向；后续填入值时会按原类型保存并标注为补充资料。
define('reference', 'template_text', 'text', '文本|文本 7');
define('reference', 'template_choice', 'choice', '单选');
define('reference', 'template_date', 'date', '日期');

export function baseFieldDefinition(table, name) {
  const field = definitions.get(name.replaceAll('\u200b', '').trim());
  if (!field) return { section: 'unmapped', key: name, kind: 'text' };
  if (table === '学科内容产出表1.0-总' && name === '周次') return { ...field, section: 'content', key: 'week' };
  if (table === '一组学员学习信息' && name === '学期') return { ...field, section: 'teaching', key: 'term' };
  return field;
}

export function baseRawHasContent(value) {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.some(baseRawHasContent);
  if (typeof value === 'object') return Object.values(value).some(baseRawHasContent);
  return true;
}

function validDay(year, month, day) {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
const pad = number => String(number).padStart(2, '0');

/** 日期只采用原字段明确给出的年月日，不使用文件日期、导入时间或其他步骤的年份补齐。 */
export function parseBaseDate(text) {
  let normalized = text.normalize('NFKC').trim();
  const zoneMatch = /\s+\(([A-Za-z_]+\/[A-Za-z_/]+)\)$/u.exec(normalized);
  const zone = zoneMatch?.[1] ?? null;
  if (zone) {
    try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(0); } catch { return null; }
    normalized = normalized.slice(0, zoneMatch.index);
  }
  if (/^\d{8}$/u.test(normalized)) normalized = `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6)}`;
  else if (/^\d{6}$/u.test(normalized)) normalized = `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
  else if (/^\d{6}\.\d{2}$/u.test(normalized)) normalized = `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(7)}`;
  const full = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?)?$/u.exec(normalized);
  if (full) {
    const [, year, month, day, hour, minute, second, offset] = full;
    if (!validDay(+year, +month, +day) || (hour !== undefined && (+hour > 23 || +minute > 59 || +(second ?? 0) > 59))) return null;
    if (offset && offset !== 'Z' && (+offset.slice(1, 3) > 14 || +offset.slice(4) > 59 || (+offset.slice(1, 3) === 14 && +offset.slice(4) !== 0))) return null;
    const date = `${year}-${pad(+month)}-${pad(+day)}`;
    return { text: hour === undefined ? date : `${date}T${pad(+hour)}:${minute}${second === undefined ? '' : `:${second}`}${offset ?? ''}`,
      precision: hour === undefined ? 'day' : second === undefined ? 'minute' : 'second', year: +year, month: +month, day: +day, ...(zone ? { zone } : {}) };
  }
  const monthDay = /^(\d{1,2})[-/.月](\d{1,2})日?$/u.exec(normalized);
  if (monthDay && validDay(2000, +monthDay[1], +monthDay[2])) return { text: `${pad(+monthDay[1])}-${pad(+monthDay[2])}`, precision: 'month_day', year: null, month: +monthDay[1], day: +monthDay[2] };
  const yearMonth = /^(\d{4})[-/.年](\d{1,2})月?$/u.exec(normalized);
  if (yearMonth && +yearMonth[2] >= 1 && +yearMonth[2] <= 12) return { text: `${yearMonth[1]}-${pad(+yearMonth[2])}`, precision: 'month', year: +yearMonth[1], month: +yearMonth[2], day: null };
  const month = /^(\d{1,2})月$/u.exec(normalized);
  if (month && +month[1] >= 1 && +month[1] <= 12) return { text: `${pad(+month[1])}月`, precision: 'month', year: null, month: +month[1], day: null };
  const chineseMonth = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'].indexOf(normalized);
  if (chineseMonth >= 0) return { text: `${pad(chineseMonth + 1)}月`, precision: 'month', year: null, month: chineseMonth + 1, day: null };
  const year = /^(\d{4})年?$/u.exec(normalized);
  if (year) return { text: year[1], precision: 'year', year: +year[1], month: null, day: null };
  return null;
}

function phoneValues(text) {
  const parts = text.normalize('NFKC').split(/[、,，;；\n/]+/u).map(value => value.trim()).filter(Boolean);
  const phones = parts.map(value => {
    if (!/^\+?[\d\s()-]+$/u.test(value)) return null;
    let digits = value.replace(/\D/gu, '');
    if (digits.length === 15 && digits.startsWith('0086')) digits = digits.slice(4);
    else if (digits.length === 13 && digits.startsWith('86')) digits = digits.slice(2);
    return /^\d{7,20}$/u.test(digits) ? digits : null;
  });
  return phones.length && phones.every(Boolean) ? [...new Set(phones)] : null;
}

function normalizeValue(kind, text) {
  if (['text', 'choice', 'label', 'reference', 'period'].includes(kind)) return { value: text, display: text, status: 'text' };
  if (kind === 'multi') {
    const values = text.split(/[、,，\n]+/u).map(value => value.trim()).filter(Boolean);
    return { value: values, display: values.join('、'), status: 'normalized' };
  }
  if (kind === 'date' || kind === 'date_or_time' || kind === 'date_or_relative') {
    const value = parseBaseDate(text);
    if (value) return { value, display: value.text, status: 'normalized' };
    if (kind === 'date_or_time' && /^\d{1,2}:\d{2}(?:\s*[-~～—]\s*\d{1,2}:\d{2})?$/u.test(text)) return { value: text, display: text, status: 'text' };
    const relative = kind === 'date_or_relative' && /^第(\d+)天$/u.exec(text);
    if (relative) return { value: { text, precision: 'relative_day', day: +relative[1], anchor: null }, display: text, status: 'normalized' };
  }
  if (kind === 'phone') {
    const value = phoneValues(text);
    if (value) return { value, display: value.join('、'), status: 'normalized' };
  }
  if (kind === 'boolean') {
    if (['是', '已', '已到', '已出勤', '出勤', '已报名', '报名', '已报', '已续', '已续报', '新报', '已缴费', '已填写', '已加', '已加V', '列入计划', '已宣讲', '已开团', '诺访', '参加', '已参加'].includes(text)) return { value: true, display: text, status: 'normalized' };
    if (['否', '未', '未到', '未出勤', '未报', '未报名', '未续', '未续报', '未填写', '未加', '未加V', '未宣讲', '未开团', '未诺访', '未参加'].includes(text)) return { value: false, display: text, status: 'normalized' };
  }
  if (kind === 'renewal_status') {
    const status = { 是: 'renewed', 已续: 'renewed', 已续报: 'renewed', 否: 'not_renewed', 未: 'not_renewed', 未续: 'not_renewed', 未续报: 'not_renewed', 新报: 'new_enrollment', '新报（不用续报）': 'new_enrollment', 已退费: 'refunded' }[text];
    if (status) return { value: status, display: text, status: 'normalized' };
  }
  if (kind === 'gender') {
    if (['男', '女'].includes(text)) return { value: text === '男' ? 'male' : 'female', display: text, status: 'normalized' };
  }
  if (kind === 'grade') {
    const label = normalizeGradeLabel(text);
    const matched = /^(?:小学)?\s*([1-7])\s*年级$/u.exec(label) ?? /^([1-7])$/u.exec(label);
    if (matched) return { value: +matched[1], display: `${matched[1]}年级`, status: 'normalized' };
    return { value: label, display: label, status: 'text' };
  }
  if (kind === 'band') {
    const value = normalizeSourceAssessmentBand(text.normalize('NFKC'));
    if (value) return { value, display: { x_plus: 'X+', g_plus: 'G+', a: 'A', a_plus: 'A+', s: 'S', c: 'C' }[value], status: 'normalized' };
  }
  if (kind === 'class_band') {
    const band = normalizeSourceAssessmentBand(text.normalize('NFKC'));
    const label = band ? { x_plus: 'X+', g_plus: 'G+', a: 'A', a_plus: 'A+', s: 'S', c: 'C' }[band] : text;
    return { value: { label, band }, display: label, status: 'normalized', ...(/[—–-]$/u.test(text) ? { review: ['class_label'] } : {}) };
  }
  if (kind === 'score_or_band') {
    const band = normalizeSourceAssessmentBand(text.normalize('NFKC'));
    if (band) return { value: { band, score: null, maxScore: null }, display: { x_plus: 'X+', g_plus: 'G+', a: 'A', a_plus: 'A+', s: 'S', c: 'C' }[band], status: 'normalized' };
    const lowerBound = /^(\d+(?:\.\d+)?)\s*[+＋]$/u.exec(text);
    if (lowerBound) return { value: { minimum: +lowerBound[1], exact: false }, display: text, status: 'normalized' };
  }
  if (kind === 'score' || kind === 'score_or_band') {
    const value = sourceScore(text);
    if (value.score !== null) return { value: { score: value.score, maxScore: value.maxScore }, display: value.maxScore === null ? String(value.score) : `${value.score}/${value.maxScore}`, status: 'normalized' };
  }
  if (kind === 'money') {
    const amount = text.normalize('NFKC').replace(/^[¥￥]\s*/u, '').replace(/\s*元$/u, '');
    if (/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/u.test(amount)) {
      const [whole, decimals = ''] = amount.replaceAll(',', '').split('.');
      const value = { amount: `${BigInt(whole)}.${decimals.padEnd(2, '0')}`, currency: 'CNY' };
      return { value, display: `${value.amount} 元`, status: 'normalized' };
    }
  }
  if (kind === 'number' && /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/u.test(text)) {
    const value = Number(text.replaceAll(',', ''));
    if (Number.isFinite(value) && value <= Number.MAX_SAFE_INTEGER) return { value, display: String(value), status: 'normalized' };
  }
  if (kind === 'attachment') return { value: null, display: text, status: 'reference' };
  return { value: null, display: text, status: 'unparsed' };
}

export function organizeBaseRecord(record) {
  if (record.source_data?.format !== 'feishu-base') return null;
  const fields = [];
  for (const cell of record.record_data.cells) {
    if (cell.kind === 'system') continue;
    const originalText = String(cell.text ?? '');
    const text = originalText.trim();
    const rawHasContent = baseRawHasContent(cell.rawValue);
    if (!text && !rawHasContent) continue;
    const definition = baseFieldDefinition(record.record_data.tableName, cell.fieldName);
    const rawText = !text && ['number', 'boolean'].includes(typeof cell.rawValue) ? String(cell.rawValue) : '';
    const value = text || rawText ? normalizeBaseSemanticValue(definition, text || rawText) ?? normalizeValue(definition.kind, text || rawText)
      : { value: { sourceValue: cell.rawValue }, display: '', status: 'reference', review: ['reference'] };
    fields.push({ fieldId: cell.fieldId, name: cell.fieldName, ...definition, ...value,
      status: definition.section === 'unmapped' ? 'unmapped' : value.status,
      originalText, sourceType: String(cell.type ?? ''), rawHasContent });
  }
  return { source_record_id: record.id, source_payload_sha256: record.payload_sha256, mapping_version: BASE_FIELD_VERSION, fields };
}

/** 覆盖率以逐格生成的结构化资料为准，分别报告原文表达、规范值和需要按原值办理的字段。 */
export function buildBaseBusinessPlan(records) {
  const baseRecords = records.filter(record => record.source_data?.format === 'feishu-base');
  const facts = baseRecords.map(organizeBaseRecord);
  const fields = new Map();
  for (let index = 0; index < baseRecords.length; index++) {
    const record = baseRecords[index], values = new Map(facts[index].fields.map(field => [field.fieldId, field]));
    for (const cell of record.record_data.cells) {
      if (cell.kind === 'system') continue;
      const key = JSON.stringify([record.source_sha256, record.source_table_id, cell.fieldId]);
      const definition = baseFieldDefinition(record.record_data.tableName, cell.fieldName);
      if (!fields.has(key)) fields.set(key, { source: record.source_data.filename, table: record.record_data.tableName,
        tableId: record.source_table_id, fieldId: cell.fieldId, field: cell.fieldName, sourceType: String(cell.type ?? ''),
        ...definition, target: 'history_source_business_facts.fields', businessKey: `${definition.section}.${definition.key}`,
        cells: 0, nonemptyText: 0, rawOnly: 0, normalized: 0, text: 0, unparsed: 0, reference: 0, unmapped: 0 });
      const row = fields.get(key), value = values.get(cell.fieldId);
      row.cells++;
      if (String(cell.text ?? '').trim()) row.nonemptyText++;
      else if (value) row.rawOnly++;
      if (value) row[value.status]++;
    }
  }
  const items = [...fields.values()];
  const sum = key => items.reduce((total, item) => total + item[key], 0);
  return { version: BASE_FIELD_VERSION, facts, summary: { records: facts.length, tables: new Set(baseRecords.map(record => `${record.source_sha256}:${record.source_table_id}`)).size,
    definitions: items.length, nonemptyDefinitions: items.filter(item => item.nonemptyText + item.rawOnly > 0).length,
    reviewFields: facts.reduce((count, fact) => count + fact.fields.filter(field => field.review?.length || field.status === 'unparsed').length, 0),
    cells: sum('cells'), nonemptyText: sum('nonemptyText'), rawOnly: sum('rawOnly'), normalized: sum('normalized'), text: sum('text'), unparsed: sum('unparsed'), reference: sum('reference'), unmapped: sum('unmapped') }, fields: items };
}

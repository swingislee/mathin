import { parseSchoolGrade } from '../../src/lib/grade-format.mjs';
import { resolveBaseFieldPlacement } from './base-field-placement.mjs';

// 每条规则绑定字段语义；原文和原字段始终由调用者原样保存。
export const normalizeBaseInputText = text => text.replace(/&(?:#x20|#32|nbsp);/giu, ' ').replace(/[\u200b\uFEFF]/gu, '').trim();
const compact = text => normalizeBaseInputText(text).normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
const normalized = (value, display, review = []) => ({ value, display, status: 'normalized', ...(review.length ? { review } : {}) });
const unresolved = (text, reason = 'unrecognized') => reason === 'missing' ? { value: null, display: '资料待补', status: 'pending' }
  : { value: null, display: text, status: 'unparsed', review: [reason] };
const words = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
function ordinal(text) {
  const value = compact(text);
  if (/^\d{1,3}$/u.test(value)) return Number(value);
  if (words.includes(value)) return words.indexOf(value);
  const match = /^([一二三四五六七八九])?十([一二三四五六七八九])?$/u.exec(value);
  return match ? (match[1] ? words.indexOf(match[1]) : 1) * 10 + (match[2] ? words.indexOf(match[2]) : 0) : null;
}
const integerText = '[零一二三四五六七八九十\\d]+';
const unitOrdinal = (text, prefix, suffix) => {
  const match = new RegExp(`^(?:${prefix})?(${integerText})(?:${suffix})?$`, 'u').exec(compact(text));
  const number = match ? ordinal(match[1]) : null;
  return number !== null && number > 0 && number <= 99 ? number : null;
};
function gradePoint(text) {
  const typo = { 三奶奶及: 3, 嗣年极: 4, 一升年级: 2, '二?年级': 2, 五六年级: 6 }[compact(text).replace(/(?:年级){2,}$/u, '年级')];
  if (typo) return { value: typo, display: `${typo}年级` };
  const grade = parseSchoolGrade(text);
  if (grade !== null) return { value: grade, display: `${grade}年级` };
  const key = compact(text);
  const stage = { 小: 'junior', 小班: 'junior', 幼儿园小班: 'junior', 幼小班: 'junior', 中: 'middle', 中班: 'middle', 幼儿园中班: 'middle', 大: 'senior', 大班: 'senior', 幼儿园大班: 'senior' }[key];
  if (stage) return { value: { stage: 'kindergarten', level: stage }, display: { junior: '小班', middle: '中班', senior: '大班' }[stage] };
  if (['没上幼儿园', '未上幼儿园', '未入园'].includes(key)) return { value: { stage: 'before_kindergarten' }, display: '未入园' };
  if (['0启蒙阶段', '启蒙阶段'].includes(key)) return { value: { stage: 'early_learning' }, display: '启蒙阶段' };
  return null;
}
export function normalizeBaseGrade(text) {
  const key = compact(text);
  const direct = gradePoint(text);
  if (direct) return normalized(direct.value, direct.display);
  if (['未知', '不详', '未填写', '待确认', '不清楚'].includes(key)) return unresolved(text, 'missing');
  const transition = /^(.*?)升(.*?)$/u.exec(key.replace(/([一二三四五六七八九\d])年升([一二三四五六七八九\d])级/u, '$1升$2'));
  if (transition) {
    const from = gradePoint(transition[1]), to = gradePoint(transition[2]);
    if (from && to) return normalized(to.value, to.display);
    return unresolved(text, 'ambiguous');
  }
  const parts = text.normalize('NFKC').trim().split(/[\s、,，/;；]+/u).filter(Boolean);
  const points = parts.map(gradePoint);
  if (parts.length > 1 && points.every(Boolean)) {
    const unique = [...new Map(points.map(point => [JSON.stringify(point.value), point])).values()];
    if (unique.length === 1) return normalized(unique[0].value, unique[0].display);
    return normalized({ children: unique.map((point, index) => ({ index: index + 1, name: null, grade: point.value, gradeLabel: point.display })), identityStatus: 'pending' },
      unique.map((point, index) => `孩子${index + 1}：${point.display}`).join('\n'), ['child_identity']);
  }
  const adjacent = /^([一二三四五六七八九])([一二三四五六七八九])(?:年级)+$/u.exec(key);
  if (adjacent) {
    const from = gradePoint(adjacent[1]), to = gradePoint(adjacent[2]);
    if (from.value < to.value) return normalized({ range: [from.value, to.value] }, `${from.display}至${to.display}`, ['multiple_grades']);
  }
  const range = /^([一二三四五六七八九\d])(?:至|到|[-~～])([一二三四五六七八九\d])(?:年级)?$/u.exec(key);
  if (range) {
    const from = gradePoint(range[1]), to = gradePoint(range[2]);
    if (from && to && from.value <= to.value) return normalized({ range: [from.value, to.value] }, `${from.display}至${to.display}`, ['multiple_grades']);
  }
  return unresolved(text, 'ambiguous');
}

const commonYes = ['是', '已', 'true', 'yes', 'y', '1'];
const commonNo = ['否', '未', 'false', 'no', 'n', '0'];
const booleanDefinitions = {
  'acquisition.group_buy_started': ['已开团', '未开团', ['开团'], []],
  'followup.wechat_added': ['已加微信', '未加微信', ['已加', '已加v', '加v', '已加微', '加微', '微信已加'], ['未加', '未加v', '未加微', '微信未加']],
  'followup.support_wechat_added': ['已加微信', '未加微信', ['已加', '已加v', '已加微', '加v', '加微'], ['未加', '未加v', '未加微']],
  'followup.teacher_wechat_added': ['已加微信', '未加微信', ['已加', '已加v', '已加微', '加v', '加微'], ['未加', '未加v', '未加微']],
  'followup.visit_committed': ['已诺访', '未诺访', ['诺访', '已承诺到访'], []],
  'followup.english_contacted': ['已沟通英语', '未沟通英语', ['已沟通'], ['未沟通']],
  'visit.attended': ['已到访', '未到访', ['已到', '到访', '已出勤', '出勤', '已参加', '参加'], ['未到', '未出勤', '未参加']],
  'visit.trial_after_assessment': ['已试听', '未试听', ['已参加', '参加', '已体验'], ['未参加', '未体验']],
  'visit.parent_trial_attended': ['已旁听', '未旁听', ['参加', '已参加', '旁听'], ['未参加']],
  'visit.parent_orientation_attended': ['已参加', '未参加', ['参加', '已到'], ['未到']],
  'visit.plan_presented': ['已宣讲', '未宣讲', ['已讲解'], ['未讲解']],
  'assessment.english_assessed': ['已体验/测评英语', '未体验/测评英语', ['已体验', '已测评'], ['未体验', '未测评']],
  'enrollment.confirmed': ['已报名', '未报名', ['报名', '已报', '已缴费', '新报', '已续', '已续报'], ['未报']],
  'enrollment.english_confirmed': ['已报名英语', '未报名英语', ['已报名', '已报', '报名'], ['未报名', '未报']],
  'enrollment.autumn_2026_active': ['在读', '非在读', ['已在读', '正在上课'], ['不在读']],
  'renewal.price_campaign_subject': ['已列入计划', '未列入计划', ['列入计划'], ['未列入', '不列入']],
  'competition.form_completed': ['已填写', '未填写', ['已填', '填写'], ['未填']],
  'competition.practice_status': ['已打卡', '未打卡', ['打卡'], []],
  'acquisition.materials_received': ['已领取', '未领取', ['领取', '已领', '领过'], ['未领']],
  'acquisition.group_buy_contact': ['已沟通', '未沟通', ['已联系'], ['未联系']],
  'teaching.reschedule_or_leave': ['有调课或请假', '无调课或请假', ['有'], ['无']],
};
function normalizeBoolean(id, text) {
  const definition = booleanDefinitions[id];
  if (!definition) return null;
  const [yes, no, aliasesYes, aliasesNo] = definition, key = compact(text);
  if ([yes, ...commonYes, ...aliasesYes].some(value => compact(value) === key)) return normalized(true, yes);
  if ([no, ...commonNo, ...aliasesNo].some(value => compact(value) === key)) return normalized(false, no);
  return unresolved(text, /待|未知|不详/u.test(text) ? 'missing' : 'ambiguous');
}

const dictionaries = new Map();
function dictionary(id, groups) {
  const entries = new Map();
  for (const [label, aliases] of groups) for (const alias of [label, ...aliases]) {
    const key = compact(alias);
    if (entries.has(key) && entries.get(key) !== label) throw new Error(`BASE_ALIAS_COLLISION:${id}:${key}`);
    entries.set(key, label);
  }
  dictionaries.set(id, entries);
}
dictionary('acquisition.channel', [
  ['地推', ['地堆', '地面推广']], ['家长转介绍', ['家长介绍', '家长推荐', '学员家长介绍', '学员家长推荐']],
  ['老师转介绍', ['老师介绍', '老师推荐']], ['学校老师转介绍', ['学校老师介绍', '学校老师推荐']],
  ['学员转介绍', ['学员介绍', '学员推荐']], ['老学员转介绍', ['老学员推荐', '老生转介绍', '老生推荐']],
  ['新生转介绍', ['新生介绍', '新生推荐']], ['转介绍', ['介绍']],
  ['小红书', ['小红书平台']],
  ['社区活动', ['小区活动']], ['上门咨询', ['到店咨询']],
]);
dictionary('finance.payment_method', [['微信', ['微信支付']], ['支付宝', ['支付宝支付']], ['现金', ['现金支付']],
  ['魔法校H5', ['魔法校h5']], ['魔法校二维码', ['魔法校扫码']], ['线下全付通', ['全付通线下']], ['线下+H5', ['线下＋h5']]]);
dictionary('followup.result', [['暂无结果', ['暂无', '无结果']], ['已加微信', ['加v', '已加v', '已加微', '加微']],
  ['未接通', ['未通', '未打通', '未拨通']], ['已诺访', ['诺访']], ['下期次再联系', ['下期再联系']]]);
dictionaries.set('confirmation.result', dictionaries.get('followup.result'));
dictionary('acquisition.wechat_status', [['已加微信', ['已加v', '加v', '已加微']], ['未加微信及群', ['未加v与群', '未加微与群']],
  ['未加微信', ['未加v', '未加微']], ['已进群', ['已加群', '进群']]]);
dictionary('visit.content', [['测评', ['能力测评']], ['散测', ['单独测评']], ['体验课', ['体验课程']],
  ['随堂试听', ['随班试听']], ['一对一沟通', ['1对1沟通', '1v1沟通']], ['一对多说明会', ['1对多说明会']]]);
dictionary('visit.product', [['散测', ['单独测评']], ['体验课', ['体验课程']]]);
dictionary('content.format', [['短视频', ['小视频']], ['图文', ['图文内容']], ['直播', []]]);
dictionary('content.channels', [['视频号', ['微信视频号']], ['私信', ['私信发送']], ['社群', ['微信群', '社群发布']]]);
dictionary('visit.parent_attendance', [['妈妈', ['母亲', '孩子妈妈']], ['爸爸', ['父亲', '孩子爸爸']],
  ['爷爷奶奶', ['爷爷、奶奶']], ['未出勤', ['未到', '未到访']]]);
dictionary('identity.education_stage', [['小学', ['小学阶段', '小学学段']], ['初中', ['初中阶段', '初中学段']],
  ['高中', ['高中阶段', '高中学段']], ['幼儿园', ['幼儿园阶段', '幼儿学段']],
  ['小学低段', ['小低学段', '小学低年级']], ['小学高段', ['小高学段', '小学高年级']]]);
// 校名仅统一相同编号、同一校区标记或同一道路名称；缺少校区的简称单独保留。
dictionary('identity.school', [['46中', ['四十六中']], ['46中南校区', ['46南校区', '46中南', '四十六中南', '46南']],
  ['三小（贵阳路）', ['三小贵阳路', '贵阳路三小']], ['三小（南京路）', ['三小南京路']],
  ['四小（四川路）', ['四小四川路']], ['万慈小学（贵阳路）', ['万慈小学(贵阳路)']]]);
dictionary('assessment.parent_approach', [['高', ['较高']], ['中', ['中等']], ['低', ['较低']]]);
dictionary('enrollment.autumn_2026_mode', [['待报名', ['待报']]]);

function lookup(id, text) { return dictionaries.get(id)?.get(compact(text)) ?? null; }
function normalizeRenewal(text) {
  const key = compact(text);
  const groups = [
    ['renewed', '已续报', ['是', '已', '已续', '续报', 'true', 'yes', '1']],
    ['not_renewed', '未续报', ['否', '未', '未续', '不续报', 'false', 'no', '0']],
    ['new_enrollment', '新报（无需续报）', ['新报', '新报名', '新报(不用续报)', '新报(无需续报)']],
    ['refunded', '已退费', ['已退款', '退费完成']],
  ];
  for (const [value, label, aliases] of groups) if ([label, ...aliases].some(alias => compact(alias) === key)) return normalized(value, label);
  return unresolved(text, 'ambiguous');
}

function normalizeSeasonalEnrollment(id, text) {
  const key = compact(text);
  const recent = {
    已续寒春: [{ winter: 'renewed', spring: 'renewed' }, '寒假、春季已续报'],
    寒春均未续报: [{ winter: 'not_renewed', spring: 'not_renewed' }, '寒假、春季未续报'],
    '新报寒(未报春)': [{ winter: 'new_enrollment', spring: 'not_enrolled' }, '寒假新报、春季未报名'],
    '新报寒春(续报窗口期后)': [{ winter: 'new_enrollment', spring: 'new_enrollment', window: 'after_renewal' }, '寒假、春季新报（续报窗口期后）'],
    续寒未续春: [{ winter: 'renewed', spring: 'not_renewed' }, '寒假已续报、春季未续报'],
    续春未续寒: [{ winter: 'not_renewed', spring: 'renewed' }, '寒假未续报、春季已续报'],
  };
  const types = { 暑秋连报: [{ seasons: ['summer', 'autumn'], mode: 'combined' }, '暑假、秋季连报'],
    单报暑: [{ seasons: ['summer'], mode: 'single' }, '仅报暑假'] };
  const campaign = { 已补续春: [{ spring: 'late_renewed' }, '春季已补续报'], 已补续寒: [{ winter: 'late_renewed' }, '寒假已补续报'],
    已补续寒春: [{ winter: 'late_renewed', spring: 'late_renewed' }, '寒假、春季已补续报'] };
  const result = (id === 'renewal.recent_status' ? recent : id === 'renewal.type' ? types : id === 'renewal.price_campaign_result' ? campaign : {})[key];
  return result ? normalized(result[0], result[1]) : null;
}

function normalizeMoney(text) {
  const key = compact(text).replace(/^(?:人民币|cny|rmb|[¥￥])/u, '').replace(/元(?:整)?$/u, '');
  const match = /^((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,6})?)([万千])?$/u.exec(key);
  if (!match) return null;
  const [whole, decimals = ''] = match[1].replaceAll(',', '').split('.');
  const power = (match[2] === '万' ? 4 : match[2] === '千' ? 3 : 0) + 2 - decimals.length;
  let cents = BigInt(whole + decimals);
  if (power >= 0) cents *= 10n ** BigInt(power);
  else { const divisor = 10n ** BigInt(-power); if (cents % divisor) return null; cents /= divisor; }
  const amount = `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
  return normalized({ amount, currency: 'CNY' }, `${amount} 元`);
}

/** 产品负责人确认：Base 到访/教学时间中省略上下午的 1–7 点按下午处理，明确写出的时段仍优先。 */
export function parseBaseTime(text) {
  const cleaned = compact(text);
  const relation = cleaned.endsWith('后') ? 'after' : null;
  const value = cleaned.replace(/后$/u, '').replace(/[；;.'‘’]/gu, ':');
  const [start, end, extra] = value.split(/至|到|[-~～—–]/u);
  if (extra !== undefined) return null;
  function point(input, inheritedPeriod = undefined) {
    const match = /^(上午|早上|下午|晚上|中午|凌晨)?(\d{1,2})(?::(\d{2})|点(?:(\d{1,2})分?|半)?)(?::(\d{2}))?$/u.exec(input);
    if (!match) return null;
    let hour = +match[2];
    const minute = +(match[3] ?? match[4] ?? (input.endsWith('半') ? 30 : 0)), second = match[5] === undefined ? null : +match[5];
    if (hour > 23 || minute > 59 || (second !== null && second > 59)) return null;
    const period = match[1] ?? inheritedPeriod;
    if (['下午', '晚上'].includes(period) && hour < 12) hour += 12;
    if (['上午', '早上', '凌晨'].includes(period) && hour > 12) return null;
    if (period === '凌晨' && hour === 12) hour = 0;
    if (period === '晚上' && hour === 12) hour = 0;
    if (period === '中午' && hour < 11) return null;
    if (!period && hour > 0 && hour < 8) hour += 12;
    return { hour, minute, second };
  }
  const first = point(start), last = end === undefined ? null : point(end, /^(上午|早上|下午|晚上|中午|凌晨)/u.exec(start)?.[1]);
  if (!first || (end !== undefined && !last)) return null;
  const format = point => `${String(point.hour).padStart(2, '0')}:${String(point.minute).padStart(2, '0')}${point.second === null ? '' : `:${String(point.second).padStart(2, '0')}`}`;
  const display = `${format(first)}${last ? `–${format(last)}` : ''}${relation ? '后' : ''}`;
  return normalized({ time: format(first), ...(last ? { endTime: format(last) } : {}), clock: '24h', ...(relation ? { relation } : {}) }, display);
}

function normalizePeriod(id, text) {
  const key = compact(text);
  if (id.endsWith('.month')) {
    const match = new RegExp(`^(${integerText})月?$`, 'u').exec(key), month = match ? ordinal(match[1]) : null;
    if (month >= 1 && month <= 12) return normalized({ unit: 'month', month, year: null }, `${month}月`);
  }
  if (id.endsWith('.week')) {
    const weekday = /^(?:周|星期|礼拜)([一二三四五六七天日1-7])$/u.exec(key);
    if (weekday) { const day = ['天', '日'].includes(weekday[1]) ? 7 : ordinal(weekday[1]); return normalized({ unit: 'weekday', day }, `周${day === 7 ? '日' : words[day]}`); }
    const monthWeek = new RegExp(`^(${integerText})月(?:第)?(${integerText})周$`, 'u').exec(key);
    if (monthWeek) {
      const month = ordinal(monthWeek[1]), week = ordinal(monthWeek[2]);
      if (month >= 1 && month <= 12 && week >= 1 && week <= 6) return normalized({ unit: 'month_week', month, week, year: null }, `${month}月第${week}周`);
    }
    const week = unitOrdinal(key, '第', '周');
    if (week) return normalized({ unit: 'week_ordinal', week }, `第${week}周`);
  }
  if (id.endsWith('.year') && /^\d{4}年?$/u.test(key)) return normalized({ unit: 'year', year: parseInt(key, 10) }, `${parseInt(key, 10)}年`);
  if (id.endsWith('.term')) {
    const season = { 春: 'spring', 春季: 'spring', 暑: 'summer', 暑假: 'summer', 暑期: 'summer', 秋: 'autumn', 秋季: 'autumn', 寒: 'winter', 寒假: 'winter', 寒期: 'winter' }[key];
    if (season) return normalized({ unit: 'season', season, year: null }, { spring: '春季', summer: '暑假', autumn: '秋季', winter: '寒假' }[season]);
    if (key === '寒春连报') return normalized({ unit: 'seasons', seasons: ['winter', 'spring'], mode: 'combined', year: null }, '寒假、春季连报');
    if (['秋季在读(窗口期前)', '秋季新报(窗口期后)'].includes(key)) return normalized({ unit: 'season', season: 'autumn',
      state: key.startsWith('秋季在读') ? 'enrolled' : 'new_enrollment', window: key.endsWith('前)') ? 'before' : 'after', year: null }, text);
    return unresolved(text, 'ambiguous');
  }
  return null;
}

export function normalizeBaseSemanticValue(definition, text) {
  const id = `${definition.section}.${definition.key}`, { kind } = definition;
  const placement = resolveBaseFieldPlacement(definition, text.normalize('NFKC'), normalizeBaseGrade);
  if (placement) return placement;
  if (kind === 'grade') return normalizeBaseGrade(text);
  if (['band', 'class_band'].includes(kind) && /^慎思[—–-]$/u.test(text)) return normalized(kind === 'band' ? 'a' : { label: 'A', band: 'a' }, 'A');
  const boolean = normalizeBoolean(id, text);
  if (boolean) return boolean;
  if (kind === 'renewal_status') return normalizeRenewal(text);
  const seasonal = normalizeSeasonalEnrollment(id, text);
  if (seasonal) return seasonal;
  if (kind === 'money') return normalizeMoney(text);
  if (kind === 'date_or_relative') {
    const day = new RegExp(`^第(${integerText})天$`, 'u').exec(compact(text)), number = day ? ordinal(day[1]) : null;
    if (number !== null && number > 0) return normalized({ text: `第${number}天`, precision: 'relative_day', day: number, anchor: null }, `第${number}天`);
  }
  if (kind === 'gender') {
    const key = compact(text);
    if (['男', '男生', '男性', '男孩', 'male', 'boy', 'm'].includes(key)) return normalized('male', '男');
    if (['女', '女生', '女性', '女孩', 'female', 'girl', 'f'].includes(key)) return normalized('female', '女');
    return unresolved(text, 'ambiguous');
  }
  if (['visit.time_slot', 'teaching.time_slot'].includes(id)) return parseBaseTime(text) ?? unresolved(text, /^[;；:：\s]+$/u.test(text) ? 'missing' : 'ambiguous');
  if (kind === 'date_or_time') { const time = parseBaseTime(text); if (time) return time; }
  if (kind === 'period') { const period = normalizePeriod(id, text); if (period) return period; }
  if (definition.key === 'group' && ['acquisition', 'followup', 'confirmation', 'visit', 'support'].includes(definition.section)) {
    const group = unitOrdinal(text, '第', '组');
    if (group) return normalized({ groupNumber: group }, `${group}组`);
  }
  if (id === 'teaching.class_order') {
    const key = compact(text).replace(/^班/u, '').replace(/班$/u, ''), number = unitOrdinal(key, '第', '');
    if (number) return normalized(number, `${number}班`);
  }
  if (id === 'teaching.lecture' || id === 'teaching.error_question') {
    const unit = id.endsWith('lecture') ? '讲' : '题', number = unitOrdinal(text, '第', unit);
    if (number) return normalized(number, `第${number}${unit}`);
  }
  if (kind === 'multi') {
    let values = [...new Set(text.split(/[、,，;；\n]+/u).map(value => value.trim()).filter(Boolean).map(value => lookup(id, value) ?? value.normalize('NFKC')))].sort();
    const review = [];
    if (id === 'acquisition.wechat_status' && values.includes('已加微信')) values = values.filter(value => !value.startsWith('未加微信'));
    if (id === 'confirmation.result' && values.includes('暂无结果') && values.some(value => ['已加微信', '未接通'].includes(value))) {
      values = values.filter(value => value !== '暂无结果');
      values.push('待下次沟通');
    }
    if (id === 'confirmation.result' && values.includes('暂无结果') && values.length > 1) review.push('conflicting_options');
    return normalized(values, values.join('、'), review);
  }
  if (id === 'followup.interest') {
    const key = compact(text);
    if (/^[abc]$/u.test(key)) return normalized({ scale: 'ABC', level: key.toUpperCase() }, key.toUpperCase());
    // 产品负责人确认：意向分类与体系兴趣度使用同一尺度，A=高、B=中、C=低。
    const level = { 高: 'A', 中: 'B', 低: 'C' }[key];
    if (level) return normalized({ scale: 'ABC', level }, level);
  }
  if (id === 'identity.education_stage' && parseSchoolGrade(text) !== null) {
    const grade = parseSchoolGrade(text);
    return normalized({ stage: grade <= 6 ? 'primary' : grade <= 9 ? 'middle' : 'high', grade }, `${grade <= 6 ? '小学' : grade <= 9 ? '初中' : '高中'}（${grade}年级）`);
  }
  const alias = lookup(id, text);
  if (alias) return normalized(alias, alias);
  if (id === 'identity.school') {
    if (['未知', '不详', '待确认', '未填写'].includes(compact(text))) return unresolved(text, 'missing');
    if (/\n|举一反三|数独|思维闯关|老生|(?:大|中|小)班$|体验.*时间/u.test(text)
      || !/小学|幼儿园|中学|学校/u.test(text) && /公园|停车|公馆|广场|方圆荟|附近/u.test(text)) return unresolved(text, 'field_mismatch');
  }
  if (/^rec[a-zA-Z0-9]{8,}$/u.test(text) && ['choice', 'reference'].includes(kind)) return { value: { sourceRecordId: text }, display: '资料待补', status: 'pending' };
  return null;
}

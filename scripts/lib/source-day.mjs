import {parseBaseDate} from './base-business-fields.mjs';

const DAY_MS = 86_400_000;
const SHANGHAI_OFFSET_MS = 8 * 3_600_000;
/** 录入先后容差：确认日期可以比同一行的获取日期早录，但不超过 3 个月。 */
const ENTRY_SLACK_MS = 92 * DAY_MS;
const pad = value => String(value).padStart(2, '0');
const isoDay = (year, month, day) => {
  const value = `${year}-${pad(month)}-${pad(day)}`;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value ? value : null;
};
const distance = (value, anchor) => Math.abs(Date.parse(value) - Date.parse(anchor));

function createdSeconds(recordData) {
  const meta = (recordData?.cells ?? []).find(cell => cell.fieldId === '__record_metadata' || cell.fieldName === '来源记录元数据');
  let value = meta?.rawValue;
  if (!value && meta?.text) { try { value = JSON.parse(meta.text); } catch { value = null; } }
  const created = Number(value?.recMeta?.createdTime);
  return Number.isFinite(created) && created > 0 ? created : null;
}
/** 飞书记录的登记时间（UTC ISO）。表内的登记顺序就是录入先后，同日或未写日期的记录按它排序。 */
export function sourceRegisteredAt(recordData) {
  const created = createdSeconds(recordData);
  return created ? new Date(created * 1000).toISOString() : null;
}
/** 飞书记录的登记日：记录创建时间按上海日期。 */
export function sourceRegisteredOn(recordData) {
  const created = createdSeconds(recordData);
  return created ? new Date(created * 1000 + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10) : null;
}

/** @typedef {{ registeredOn?: string | null, notBefore?: string | null, notAfter?: string | null }} SourceDayBounds */
/** @typedef {{ day: string, basis: 'explicit' | 'registration_order' }} SourceDayResult */

/** 同月日在登记日前后各一年的候选中取离登记日最近的一个；不晚于导出日，不早于同行已知的更早日期（容许录入先后）。
 *  没有候选同时满足两端时不补年。 */
function nearestToRegistration(candidates, { registeredOn, notBefore, notAfter }) {
  return candidates.filter(value => value && (!notAfter || value <= notAfter)
    && (!notBefore || Date.parse(value) >= Date.parse(notBefore) - ENTRY_SLACK_MS))
    .sort((a, b) => distance(a, registeredOn) - distance(b, registeredOn))[0] ?? null;
}

/**
 * 来源日期。写全年月日的原样采用（basis = explicit）；只写“10.14”“10/10”等月日的，按登记顺序补年
 * （basis = registration_order）。用 10-14 获客表 2,663 个带年份的日期去掉年份回测，全部还原。
 * 没有登记日时不补年，返回 null。
 * @param {string | null | undefined} text
 * @param {SourceDayBounds} [bounds]
 * @returns {SourceDayResult | null}
 */
export function sourceDay(text, { registeredOn = null, notBefore = null, notAfter = null } = {}) {
  const parsed = parseBaseDate(text ?? '');
  if (!parsed) return null;
  if (parsed.year && parsed.day) return { day: parsed.text.slice(0, 10), basis: 'explicit' };
  if (parsed.precision !== 'month_day' || !registeredOn) return null;
  const year = Number(registeredOn.slice(0, 4));
  const day = nearestToRegistration([year - 1, year, year + 1].map(value => isoDay(value, parsed.month, parsed.day)), { registeredOn, notBefore, notAfter });
  return day ? { day, basis: 'registration_order' } : null;
}

const CONTACT_DATE_FIELDS = { confirmation: '确认日期', followup: '跟进日期', project: '沟通日期' };
const CONTACT_MONTH_FIELDS = { confirmation: '确认月份', followup: '跟进月份', project: '沟通月份' };
/** 获客表一次联系的日期；确认不早于同行的获取日期（容许录入先后）。read 按字段名读取原文。
 * @param {(name: string) => string} read
 * @param {string} phase
 * @param {{ registeredOn?: string | null, notAfter?: string | null }} [bounds]
 * @returns {SourceDayResult | null}
 */
export function sourceContactDay(read, phase, { registeredOn = null, notAfter = null } = {}) {
  const acquired = phase === 'confirmation' ? sourceDay(read('获取日期'), { registeredOn, notAfter })?.day ?? null : null;
  return sourceDay(read(CONTACT_DATE_FIELDS[phase] ?? ''), { registeredOn, notBefore: acquired, notAfter });
}

/**
 * 联系日期连同依据与疑点，写入数据供界面提示。
 * basis：explicit 原表写全年月日；registration_order 年份按登记顺序补全；month_only 原表只写月份。
 * review（需人工核对）：far_from_registration 补出的日期离登记日超过 3 个月；month_conflict 月份栏与日期不一致；
 * no_plausible_year 找不到不早于获取日期、不晚于导出日的年份；no_registration 缺登记时间无法补年；unparsed 原文不是日期。
 * @param {(name: string) => string} read
 * @param {string} phase
 * @param {{ registeredOn?: string | null, notAfter?: string | null }} [bounds]
 * @returns {{ label: string | null, day: string | null, basis: string | null, review: string | null }}
 */
export function sourceContactDating(read, phase, { registeredOn = null, notAfter = null } = {}) {
  const label = read(CONTACT_DATE_FIELDS[phase] ?? '');
  if (!label) return { label: null, day: null, basis: null, review: null };
  const resolved = sourceContactDay(read, phase, { registeredOn, notAfter });
  const parsed = parseBaseDate(label);
  let basis = resolved?.basis ?? (parsed?.precision === 'month' ? 'month_only' : null), review = null;
  if (resolved?.basis === 'registration_order' && distance(resolved.day, registeredOn) > ENTRY_SLACK_MS) review = 'far_from_registration';
  if (!resolved && parsed?.precision === 'month_day') review = registeredOn ? 'no_plausible_year' : 'no_registration';
  if (!resolved && !parsed) review = 'unparsed';
  const month = parseBaseDate(read(CONTACT_MONTH_FIELDS[phase] ?? ''))?.month;
  const dayMonth = resolved ? Number(resolved.day.slice(5, 7)) : parsed?.month;
  if (!review && month && dayMonth && month !== dayMonth) review = 'month_conflict';
  return { label, day: resolved?.day ?? null, basis, review };
}

/** 只写月份（“10月”“一月”）的，同样按登记顺序取最近的年份，返回 YYYY-MM。
 * @param {string | null | undefined} text
 * @param {{ registeredOn?: string | null, notAfter?: string | null }} [bounds]
 * @returns {string | null}
 */
export function sourceMonth(text, { registeredOn = null, notAfter = null } = {}) {
  const parsed = parseBaseDate(text ?? '');
  if (!parsed?.month || parsed.day) return null;
  if (parsed.year) return `${parsed.year}-${pad(parsed.month)}`;
  if (!registeredOn) return null;
  const year = Number(registeredOn.slice(0, 4)), anchor = `${registeredOn.slice(0, 7)}-01`;
  const months = [year - 1, year, year + 1].map(value => `${value}-${pad(parsed.month)}-01`)
    .filter(value => !notAfter || value.slice(0, 7) <= notAfter.slice(0, 7));
  return months.sort((a, b) => distance(a, anchor) - distance(b, anchor))[0]?.slice(0, 7) ?? null;
}

/** 来源日期的依据与疑点（导入时写入 source_metric_facts.dateBasis／dateReview）。 */
export type SourceDateBasis = 'explicit' | 'registration_order' | 'month_only';
export type SourceDateReview = 'far_from_registration' | 'month_conflict' | 'no_plausible_year' | 'no_registration' | 'unparsed';
export interface SourceDateMarks { basis?: string | null; review?: string | null; label?: string | null }
/** review 为真时界面以橙色“日期待核对”提示；否则以虚线下划线说明日期由来。 */
export interface SourceDateNote { review: boolean; short: string; text: string }

/** 只有推断、只记月份或需要核对的日期返回说明；原表写全年月日的不提示。 */
export function sourceDateNote(marks: SourceDateMarks | null | undefined, locale: string): SourceDateNote | null {
  if (!marks) return null;
  const en = locale.startsWith('en');
  const label = (marks.label ?? '').trim().slice(0, 40);
  const quoted = label ? `“${label}”` : '';
  const reviews: Record<SourceDateReview, string> = en ? {
    far_from_registration: `The sheet says ${quoted}; the completed date is more than three months from when the row was entered. Check the year.`,
    month_conflict: `The sheet date ${quoted} does not match its month column; a later call may have overwritten the date. Check against the note.`,
    no_plausible_year: `The sheet says ${quoted}, but no year fits between acquisition and export. Check the date.`,
    no_registration: `The sheet says ${quoted} without a year, and the entry time is missing.`,
    unparsed: `The date column says ${quoted}, which is not a date.`,
  } : {
    far_from_registration: `原表记为${quoted}，补出的日期与登记时间相隔超过 3 个月，请核对年份。`,
    month_conflict: `原表日期${quoted}与月份栏不一致，可能是后来的联系覆盖了日期，请对照备注核对。`,
    no_plausible_year: `原表记为${quoted}，在获取日期与导出日之间找不到合理的年份，请核对。`,
    no_registration: `原表记为${quoted}，缺少登记时间，无法补全年份。`,
    unparsed: `原表日期栏写的是${quoted}，无法识别为日期。`,
  };
  if (marks.review && marks.review in reviews) return { review: true, short: en ? 'Date to verify' : '日期待核对', text: reviews[marks.review as SourceDateReview] };
  if (marks.basis === 'registration_order') return { review: false, short: en ? 'Year inferred' : '年份按登记补全',
    text: en ? `The sheet says ${quoted}; the year is completed from the order in which rows were entered.` : `原表记为${quoted}，年份按表内登记先后补全。` };
  if (marks.basis === 'month_only') return { review: false, short: en ? 'Month only' : '只记月份',
    text: en ? `The sheet only records ${quoted}, without a day.` : `原表只写了${quoted}，没有具体日期。` };
  return null;
}

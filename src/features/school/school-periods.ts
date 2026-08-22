export type SchoolPeriod = 1 | 2 | 3 | 4;

/** 只格式化 UI 标签；数据库中的 name 保留为审计数据，不承担界面语言。 */
export function schoolTermLabel(term: { year: number; term: SchoolPeriod }, periodLabel: string) {
  return `${term.year}–${term.year + 1} · ${periodLabel}`;
}

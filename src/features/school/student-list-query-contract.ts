import type { DashboardFieldDefinitions, DashboardFieldFacet, DashboardFieldQuery } from "./dashboard-page/dashboard-table-field-contract";

export function studentListFieldLabels<Row>(fields: DashboardFieldDefinitions<Row>) {
  return Object.fromEntries(Object.entries(fields).filter(([, field]) => field.kind === "enum" && field.options)
    .map(([id, field]) => [id, Object.fromEntries(field.kind === "enum" ? (field.options ?? []).map(option => [option.value, option.label]) : [])]));
}

/** 文本条件的 trim 与共享字段匹配合同一致，界面仍保留用户输入。 */
export function studentListRpcQuery(query: DashboardFieldQuery): DashboardFieldQuery {
  return { ...query, filters: Object.fromEntries(Object.entries(query.filters).map(([id, filter]) =>
    [id, filter.kind === "text" ? { ...filter, query: filter.query.trim() } : filter])) };
}

/** 候选统计由数据库完成；翻译、菜单顺序和同名提示复用现有字段定义。 */
export function studentListFacets<Row>(source: Record<string, DashboardFieldFacet>, fields: DashboardFieldDefinitions<Row>, locale: string) {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  return Object.fromEntries(Object.entries(fields).map(([id, field]) => {
    const facet = source[id] ?? { options: [], days: [] };
    if (field.kind !== "enum") return [id, facet];
    const available = new Set(facet.options.map(option => option.value));
    const options = field.options ? field.options.filter(option => available.has(option.value))
      : [...facet.options].sort((a, b) => collator.compare(a.label, b.label));
    const counts = new Map<string, number>();
    for (const option of options) counts.set(option.label, (counts.get(option.label) ?? 0) + 1);
    return [id, { options: options.map(option => counts.get(option.label)! > 1
      ? { ...option, label: `${option.label} · ${option.value.slice(0, 8)}` } : option), days: [] }];
  }));
}

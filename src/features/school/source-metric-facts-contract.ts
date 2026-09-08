export const SOURCE_METRIC_KEYS = ["contacts", "invitations", "arrivals", "assessments", "enrollments", "activityRegistrations"] as const;
export type SourceMetricKey = typeof SOURCE_METRIC_KEYS[number];

/** 导入时确认的业务标签；业务月份与实际发生日期分别保存。 */
export interface SourceMetricFacts {
  version: 1;
  sourceKey: string;
  sourceName: string;
  sourceTable: string;
  sourceVersion: string;
  scope: "acquisition" | "selection" | "activity" | "other";
  confirmed: Partial<Record<SourceMetricKey, boolean>>;
  months: Partial<Record<SourceMetricKey, string | null>>;
  staff: Partial<Record<SourceMetricKey, string>>;
  evidence: string[];
}

export function readSourceMetricFacts(value: unknown): SourceMetricFacts | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.version !== 1 || typeof row.sourceKey !== "string" || !row.sourceKey
    || typeof row.sourceName !== "string" || typeof row.sourceTable !== "string" || typeof row.sourceVersion !== "string"
    || !["acquisition", "selection", "activity", "other"].includes(String(row.scope))
    || !row.confirmed || typeof row.confirmed !== "object" || !row.months || typeof row.months !== "object"
    || !row.staff || typeof row.staff !== "object" || !Array.isArray(row.evidence)) return null;
  const confirmed: SourceMetricFacts["confirmed"] = {}, months: SourceMetricFacts["months"] = {}, staff: SourceMetricFacts["staff"] = {};
  for (const key of SOURCE_METRIC_KEYS) {
    const flag = (row.confirmed as Record<string, unknown>)[key];
    const month = (row.months as Record<string, unknown>)[key];
    const person = (row.staff as Record<string, unknown>)[key];
    if (flag !== undefined && typeof flag !== "boolean") return null;
    if (month !== undefined && month !== null && (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) return null;
    if (person !== undefined && typeof person !== "string") return null;
    if (flag !== undefined) confirmed[key] = flag;
    if (month !== undefined) months[key] = month as string | null;
    if (person !== undefined) staff[key] = person;
  }
  return { version: 1, sourceKey: row.sourceKey, sourceName: row.sourceName, sourceTable: row.sourceTable,
    sourceVersion: row.sourceVersion, scope: row.scope as SourceMetricFacts["scope"], confirmed, months, staff,
    evidence: row.evidence.filter((field): field is string => typeof field === "string") };
}

/** 同一原表行跨导出批次只保留最新版本；同名或同日的不同原表行各自保留。 */
export function uniqueSourceMetricRows<T extends { id: string; source_metric_facts?: unknown }>(rows: readonly T[]): T[] {
  const chosen = new Map<string, T>();
  for (const row of rows) {
    const facts = readSourceMetricFacts(row.source_metric_facts);
    const key = facts?.sourceKey ?? row.id;
    const previous = chosen.get(key);
    if (!previous || (facts?.sourceVersion ?? "") > (readSourceMetricFacts(previous.source_metric_facts)?.sourceVersion ?? "")) chosen.set(key, row);
  }
  return [...chosen.values()];
}

import { dashboardDateSortValue, dashboardDay, validDashboardDateRange, type DashboardDateRange } from "./dashboard-table-date-contract";

export type DashboardFieldScalar = string | number | boolean | null | undefined;
export interface DashboardFieldOption { value: string; label: string }
interface FieldBase<Row> {
  label: string;
  hint?: string;
  sortable?: boolean;
  sortValue?: (row: Row) => DashboardFieldScalar;
  /** 原分等字段要求先选定一个可比较的量尺。 */
  requiresSingleValue?: string;
}
export type DashboardFieldDefinition<Row> = FieldBase<Row> & (
  | { kind: "text"; value: (row: Row) => string | null | undefined }
  | { kind: "enum"; values: (row: Row) => readonly DashboardFieldOption[]; options?: readonly DashboardFieldOption[]; multiple?: boolean }
  | { kind: "number"; value: (row: Row) => number | null | undefined; step?: number }
  | { kind: "date"; value: (row: Row) => string | null | undefined }
);
export type DashboardFieldDefinitions<Row> = Record<string, DashboardFieldDefinition<Row>>;
export type DashboardFieldFilter =
  | { kind: "text"; query: string }
  | { kind: "enum"; values: string[] }
  | { kind: "number"; min?: number; max?: number }
  | ({ kind: "date" } & DashboardDateRange)
  | { kind: "presence"; value: "present" | "missing" };
export type DashboardFieldFilters = Record<string, DashboardFieldFilter>;
export interface DashboardFieldSort { field: string; direction: "asc" | "desc" }
export interface DashboardFieldQuery { version: 2; filters: DashboardFieldFilters; sort: DashboardFieldSort | null }
export const EMPTY_DASHBOARD_FIELD_QUERY: DashboardFieldQuery = { version: 2, filters: {}, sort: null };

function missing(value: DashboardFieldScalar): boolean {
  return value === null || value === undefined || typeof value === "string" && !value.trim()
    || typeof value === "number" && !Number.isFinite(value);
}

export function dashboardFieldEnabled<Row>(definition: DashboardFieldDefinition<Row>, filters: DashboardFieldFilters): boolean {
  if (!definition.requiresSingleValue) return true;
  const scope = filters[definition.requiresSingleValue];
  return scope?.kind === "enum" && scope.values.length === 1;
}

function fieldMissing<Row>(row: Row, field: DashboardFieldDefinition<Row>, timeZone: string): boolean {
  if (field.kind === "enum") return field.values(row).length === 0;
  const value = field.value(row);
  return field.kind === "date" ? !dashboardDay(value as string | null, timeZone) : missing(value);
}

export function matchesDashboardField<Row>(
  row: Row, field: DashboardFieldDefinition<Row>, filter: DashboardFieldFilter, locale: string, timeZone: string,
): boolean {
  if (filter.kind === "presence") return fieldMissing(row, field, timeZone) === (filter.value === "missing");
  if (filter.kind === "text" && field.kind === "text") return (field.value(row) ?? "").toLocaleLowerCase(locale).includes(filter.query.trim().toLocaleLowerCase(locale));
  if (filter.kind === "enum" && field.kind === "enum") return field.values(row).some(option => filter.values.includes(option.value));
  if (filter.kind === "number" && field.kind === "number") {
    const value = field.value(row);
    return typeof value === "number" && Number.isFinite(value) && (filter.min === undefined || value >= filter.min) && (filter.max === undefined || value <= filter.max);
  }
  if (filter.kind === "date" && field.kind === "date") {
    const day = dashboardDay(field.value(row), timeZone);
    return Boolean(day && day >= filter.from && day <= filter.to);
  }
  return false;
}

function matchingRows<Row>(rows: readonly Row[], fields: DashboardFieldDefinitions<Row>, filters: DashboardFieldFilters, locale: string, timeZone: string, except?: string): Row[] {
  return rows.filter(row => Object.entries(filters).every(([id, filter]) => id === except
    || !Object.hasOwn(fields, id) || !dashboardFieldEnabled(fields[id], filters) || matchesDashboardField(row, fields[id], filter, locale, timeZone)));
}

export function filterAndSortDashboardFields<Row>(
  rows: readonly Row[], fields: DashboardFieldDefinitions<Row>, query: DashboardFieldQuery, locale: string, timeZone: string,
): Row[] {
  const filtered = matchingRows(rows, fields, query.filters, locale, timeZone);
  const sort = query.sort;
  const field = sort && fields[sort.field];
  if (!sort || !field || field.sortable === false || !dashboardFieldEnabled(field, query.filters)) return filtered;
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const sortValue = (row: Row): DashboardFieldScalar => field.sortValue ? field.sortValue(row)
    : field.kind === "enum" ? field.values(row)[0]?.label
    : field.kind === "date" ? dashboardDateSortValue(field.value(row), timeZone) : field.value(row);
  return filtered.map((row, index) => ({ row, index, value: sortValue(row) })).sort((left, right) => {
    const aMissing = missing(left.value), bMissing = missing(right.value);
    if (aMissing || bMissing) return aMissing === bMissing ? left.index - right.index : aMissing ? 1 : -1;
    const compared = typeof left.value === "number" && typeof right.value === "number" ? left.value - right.value
      : typeof left.value === "boolean" && typeof right.value === "boolean" ? Number(left.value) - Number(right.value)
      : collator.compare(String(left.value), String(right.value));
    return compared * (sort.direction === "asc" ? 1 : -1) || left.index - right.index;
  }).map(item => item.row);
}

export interface DashboardFieldFacet { options: DashboardFieldOption[]; days: string[] }
export function dashboardFieldFacets<Row>(
  rows: readonly Row[], fields: DashboardFieldDefinitions<Row>, filters: DashboardFieldFilters, locale: string, timeZone: string,
): Record<string, DashboardFieldFacet> {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  return Object.fromEntries(Object.entries(fields).map(([id, field]) => {
    // 文本与数值不会生成逐行枚举，避免复制姓名、电话和整段备注。
    if (field.kind !== "enum" && field.kind !== "date") return [id, { options: [], days: [] }];
    const available = matchingRows(rows, fields, filters, locale, timeZone, id);
    if (field.kind === "date") return [id, { options: [], days: [...new Set(available.map(row => dashboardDay(field.value(row), timeZone)).filter((day): day is string => Boolean(day)))].sort().reverse() }];
    const allOptions = new Map<string, DashboardFieldOption>();
    for (const row of rows) for (const option of field.values(row)) if (!allOptions.has(option.value)) allOptions.set(option.value, option);
    const availableIds = new Set(available.flatMap(row => field.values(row).map(option => option.value)));
    const selected = filters[id];
    if (selected?.kind === "enum") for (const value of selected.values) availableIds.add(value);
    const options = field.options ? field.options.filter(option => availableIds.has(option.value))
      : [...availableIds].flatMap(value => allOptions.has(value) ? [allOptions.get(value)!] : [{ value, label: value }]).sort((a, b) => collator.compare(a.label, b.label));
    const labelCounts = new Map<string, number>();
    for (const option of options) labelCounts.set(option.label, (labelCounts.get(option.label) ?? 0) + 1);
    return [id, { options: options.map(option => labelCounts.get(option.label)! > 1
      ? { ...option, label: `${option.label} · ${option.value.slice(0, 8)}` } : option), days: [] }];
  }));
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function normalizeDashboardFieldFilter<Row>(field: DashboardFieldDefinition<Row>, value: unknown): DashboardFieldFilter | undefined {
  if (!record(value)) return undefined;
  if (value.kind === "presence" && (value.value === "present" || value.value === "missing")) return { kind: "presence", value: value.value };
  if (value.kind !== field.kind) return undefined;
  if (value.kind === "text" && typeof value.query === "string") {
    const query = value.query.slice(0, 160);
    return query.trim() ? { kind: "text", query } : undefined;
  }
  if (value.kind === "enum" && field.kind === "enum" && Array.isArray(value.values)) {
    const values = [...new Set(value.values.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 160))]
      .filter(item => !field.options || field.options.some(option => option.value === item)).slice(0, field.multiple === false ? 1 : 100);
    return values.length ? { kind: "enum", values } : undefined;
  }
  if (value.kind === "number") {
    const min = typeof value.min === "number" && Number.isFinite(value.min) ? value.min : undefined;
    const max = typeof value.max === "number" && Number.isFinite(value.max) ? value.max : undefined;
    return (min !== undefined || max !== undefined) && !(min !== undefined && max !== undefined && min > max) ? { kind: "number", min, max } : undefined;
  }
  if (value.kind === "date" && typeof value.from === "string" && typeof value.to === "string" && validDashboardDateRange({ from: value.from, to: value.to })) {
    return { kind: "date", from: value.from, to: value.to };
  }
  return undefined;
}

export function normalizeDashboardFieldQuery<Row>(fields: DashboardFieldDefinitions<Row>, value: unknown): DashboardFieldQuery {
  if (!record(value) || value.version !== 2 || !record(value.filters)) return { ...EMPTY_DASHBOARD_FIELD_QUERY, filters: {} };
  const filters: DashboardFieldFilters = {};
  for (const [id, condition] of Object.entries(value.filters)) {
    const field = Object.hasOwn(fields, id) ? fields[id] : undefined;
    const filter = field && normalizeDashboardFieldFilter(field, condition);
    if (filter) filters[id] = filter;
  }
  for (const id of Object.keys(filters)) if (!dashboardFieldEnabled(fields[id], filters)) delete filters[id];
  const sort = value.sort;
  return { version: 2, filters, sort: record(sort) && typeof sort.field === "string" && Object.hasOwn(fields, sort.field) && fields[sort.field]?.sortable !== false
    && dashboardFieldEnabled(fields[sort.field], filters) && (sort.direction === "asc" || sort.direction === "desc") ? { field: sort.field, direction: sort.direction } : null };
}

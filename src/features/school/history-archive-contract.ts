export const HISTORY_MATCH_STATUSES = ["matched", "review", "unmatched"] as const;
export type HistoryMatchStatus = (typeof HISTORY_MATCH_STATUSES)[number];

export interface HistoryArchiveFilters {
  q: string;
  status: HistoryMatchStatus | "all";
  table: string;
  page: number;
  pageSize: number;
  record: string;
  relatedPage: number;
}

export interface HistoryArchiveEntity {
  key: string;
  kind: "student" | "lead";
  name: string;
  phones: string[];
  grade: number | null;
  sourceKeys: string[];
  gradeCorrection: unknown | null;
}

export interface HistoryArchiveRow {
  id: string;
  label: string;
  sourceName: string;
  tableName: string;
  sourceRecordId: string;
  sourceRow: number | null;
  dateLabel: string | null;
  names: string[];
  phones: string[];
  excerpt: string;
  matchStatus: HistoryMatchStatus;
  matchReason: string;
  entity: HistoryArchiveEntity | null;
  candidateCount: number;
  warnings: string[];
}

export interface HistoryArchiveCell {
  fieldId: string;
  fieldName: string;
  type: string | number | null;
  text: string;
  rawValue: unknown;
  kind: "identity" | "narrative" | "context" | "system";
}

export interface HistoryArchiveSummary {
  available: boolean;
  generatedAt: string | null;
  sourceCount: number;
  tableCount: number;
  recordCount: number;
  contentRecordCount: number;
  matchedCount: number;
  reviewCount: number;
  unmatchedCount: number;
  gradeCorrectionCount: number;
  excludedCommunicationCount: number;
  archivedClassCount: number;
  tables: { id: string; name: string; sourceName: string; records: number }[];
}

export interface HistoryArchivePageData {
  summary: HistoryArchiveSummary;
  rows: HistoryArchiveRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface HistoryArchiveDetail {
  record: HistoryArchiveRow;
  cells: HistoryArchiveCell[];
  candidates: HistoryArchiveEntity[];
  related: HistoryArchiveRow[];
  relatedTotal: number;
  relatedPage: number;
  relatedPageSize: number;
  sourceHash: string;
}

function scalar(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function positiveInteger(value: string, fallback: number, max: number): number {
  if (!/^\d+$/.test(value)) return fallback;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

export function parseHistoryArchiveFilters(raw: Record<string, string | string[] | undefined>): HistoryArchiveFilters {
  const status = scalar(raw.status);
  const size = positiveInteger(scalar(raw.pageSize), 25, 100);
  return {
    q: scalar(raw.q).trim().slice(0, 200),
    status: HISTORY_MATCH_STATUSES.includes(status as HistoryMatchStatus) ? status as HistoryMatchStatus : "all",
    table: scalar(raw.table).slice(0, 160),
    page: positiveInteger(scalar(raw.page), 1, 1_000_000),
    pageSize: [25, 50, 100].includes(size) ? size : 25,
    record: scalar(raw.record).slice(0, 160),
    relatedPage: positiveInteger(scalar(raw.relatedPage), 1, 1_000_000),
  };
}

export function historyArchiveHref(filters: HistoryArchiveFilters, changes: Partial<HistoryArchiveFilters> = {}): string {
  const next = { ...filters, ...changes };
  const query = new URLSearchParams();
  if (next.q) query.set("q", next.q);
  if (next.status !== "all") query.set("status", next.status);
  if (next.table) query.set("table", next.table);
  if (next.page > 1) query.set("page", String(next.page));
  if (next.pageSize !== 25) query.set("pageSize", String(next.pageSize));
  if (next.record) query.set("record", next.record);
  if (next.relatedPage > 1) query.set("relatedPage", String(next.relatedPage));
  return `/dashboard/history-import${query.size ? `?${query}` : ""}`;
}

export function isLocalHistoryArchiveEnvironment(nodeEnv: string | undefined, supabaseUrl: string | undefined): boolean {
  if (nodeEnv !== "development") return false;
  try {
    const url = new URL(supabaseUrl ?? "");
    return url.origin === "http://127.0.0.1:35421" && !url.username && !url.password;
  } catch {
    return false;
  }
}

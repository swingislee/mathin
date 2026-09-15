import { readDashboardDetail } from "../dashboard-page/readDashboardDetail";
import { teachingRecordsSchema, type TeachingRecords } from "./teaching-records-contract";

export type TeachingRecordCache = Map<string, { data: TeachingRecords; expires: number }>;
export type TeachingRecordQuery = { sessionId: string; contactPage: number; pageSize: 10 | 20; replayId?: "2026-09-07" };

/** 缓存仅由当前工作台实例持有；短时重复展开复用，卸载后释放。 */
export async function readTeachingInlineRecords(cache: TeachingRecordCache, locale: string, query: TeachingRecordQuery, signal: AbortSignal) {
  const key = `${query.replayId ?? "live"}:${locale}:${query.sessionId}:${query.contactPage}:${query.pageSize}`;
  signal.throwIfAborted();
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.data;
  cache.delete(key);
  const data = teachingRecordsSchema.parse(await readDashboardDetail<unknown>(`/${locale}/dashboard/teaching/records-detail`, query, signal));
  signal.throwIfAborted();
  cache.set(key, { data, expires: Date.now() + 30000 });
  if (cache.size > 8) cache.delete(cache.keys().next().value!);
  return data;
}

import "server-only";

type QueryResult<T> = { data: T[] | null; error: { message: string; code?: string } | null };

// 与 Supabase REST 的 1000 行上限对齐，减少重复扫描同一视图与 RLS。
const QUERY_PAGE_SIZE = 1000;
export const SCHOOL_QUERY_ID_BATCH_SIZE = 80;
const ID_BATCH_CONCURRENCY = 4;

/** 分页避开接口行数上限，关联 ID 分批控制请求 URL 长度。 */
export async function readSchoolQueryPages<T>(
  page: (start: number, end: number) => PromiseLike<QueryResult<T>>,
): Promise<QueryResult<T>> {
  const rows: T[] = [];
  for (let start = 0; ; start += QUERY_PAGE_SIZE) {
    const result = await page(start, start + QUERY_PAGE_SIZE - 1);
    if (result.error) return { data: null, error: result.error };
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < QUERY_PAGE_SIZE) return { data: rows, error: null };
  }
}

export async function readSchoolQueryBatches<T>(
  ids: readonly string[],
  page: (batch: string[], start: number, end: number) => PromiseLike<QueryResult<T>>,
): Promise<QueryResult<T>> {
  const uniqueIds = [...new Set(ids)];
  const rows: T[] = [];
  for (let index = 0; index < uniqueIds.length; index += SCHOOL_QUERY_ID_BATCH_SIZE * ID_BATCH_CONCURRENCY) {
    const batches = Array.from({ length: ID_BATCH_CONCURRENCY }, (_, offset) =>
      uniqueIds.slice(index + offset * SCHOOL_QUERY_ID_BATCH_SIZE, index + (offset + 1) * SCHOOL_QUERY_ID_BATCH_SIZE))
      .filter(batch => batch.length > 0);
    const results = await Promise.allSettled(batches.map(batch => readSchoolQueryPages((start, end) => page(batch, start, end))));
    // 并发只影响等待时间；结果顺序和失败行为按原 ID 批次保持。
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
      if (result.value.error) return { data: null, error: result.value.error };
      rows.push(...(result.value.data ?? []));
    }
  }
  return { data: rows, error: null };
}

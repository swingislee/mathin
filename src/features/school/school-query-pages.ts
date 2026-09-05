import "server-only";

type QueryResult<T> = { data: T[] | null; error: { message: string; code?: string } | null };

const QUERY_PAGE_SIZE = 200;
export const SCHOOL_QUERY_ID_BATCH_SIZE = 80;

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
  for (let index = 0; index < uniqueIds.length; index += SCHOOL_QUERY_ID_BATCH_SIZE) {
    const batch = uniqueIds.slice(index, index + SCHOOL_QUERY_ID_BATCH_SIZE);
    const result = await readSchoolQueryPages((start, end) => page(batch, start, end));
    if (result.error) return { data: null, error: result.error };
    rows.push(...(result.data ?? []));
  }
  return { data: rows, error: null };
}

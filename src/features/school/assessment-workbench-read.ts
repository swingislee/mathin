import "server-only";

interface ReadResult<T> {
  data: T | null;
  error: { message: string } | null;
}

interface ReadQuery {
  eq(column: string, value: unknown): ReadQuery;
  is(column: string, value: null): ReadQuery;
  in(column: string, values: readonly string[]): ReadQuery;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): ReadQuery;
  range(from: number, to: number): ReadQuery;
  returns<T>(): PromiseLike<ReadResult<T>>;
}

type ReadFrom = (relation: string) => { select(columns: string): ReadQuery };

export function assessmentReadFrom(supabase: { from: unknown }): ReadFrom {
  return (supabase.from as ReadFrom).bind(supabase);
}

// 与本机和生产 REST 的 1000 行上限一致；关联键仍限制在 80 个以控制 URL 长度。
const PAGE_SIZE = 1000;
const RELATED_BATCH_SIZE = 80;
const RELATED_CONCURRENCY = 4;

export async function readAllAssessmentRows<T>(buildQuery: () => ReadQuery): Promise<ReadResult<T[]>> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await buildQuery().order("id", { ascending: true }).range(offset, offset + PAGE_SIZE - 1).returns<T[]>();
    if (result.error) return { data: null, error: result.error };
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return { data: rows, error: null };
  }
}

/** 四组关联键并行读取，合并顺序沿用输入批次；每批继续读完其全部分页。 */
export async function readRelatedAssessmentRows<T>(
  supabase: { from: unknown }, relation: string, columns: string, key: string, ids: readonly string[],
): Promise<ReadResult<T[]>> {
  const rows: T[] = [];
  const uniqueIds = [...new Set(ids)];
  for (let offset = 0; offset < uniqueIds.length; offset += RELATED_BATCH_SIZE * RELATED_CONCURRENCY) {
    const batches = Array.from({ length: Math.min(RELATED_CONCURRENCY, Math.ceil((uniqueIds.length - offset) / RELATED_BATCH_SIZE)) }, (_, index) => {
      const start = offset + index * RELATED_BATCH_SIZE;
      const batch = uniqueIds.slice(start, start + RELATED_BATCH_SIZE);
      return readAllAssessmentRows<T>(() => assessmentReadFrom(supabase)(relation).select(columns).in(key, batch));
    });
    const results = await Promise.allSettled(batches);
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
      if (result.value.error) return { data: null, error: result.value.error };
      rows.push(...(result.value.data ?? []));
    }
  }
  return { data: rows, error: null };
}

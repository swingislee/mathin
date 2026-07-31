/**
 * PostgREST serializes filters such as `.in()` into the request URI, including
 * for PATCH and DELETE requests. Keep UUID lists comfortably below common
 * gateway request-line limits.
 */
export const POSTGREST_FILTER_BATCH_SIZE = 40;
const POSTGREST_BATCH_CONCURRENCY = 4;

interface PostgrestBatchResult<TRow> {
  data: TRow[] | null;
  error: { message: string } | null;
}

export function postgrestFilterBatches<T>(
  values: readonly T[],
  batchSize = POSTGREST_FILTER_BATCH_SIZE,
): T[][] {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("POSTGREST_BATCH_SIZE_INVALID");
  }

  const batches: T[][] = [];
  for (let offset = 0; offset < values.length; offset += batchSize) {
    batches.push(values.slice(offset, offset + batchSize));
  }
  return batches;
}

export async function collectPostgrestRowsInBatches<TValue, TRow>(
  values: readonly TValue[],
  loadBatch: (batch: TValue[]) => PromiseLike<PostgrestBatchResult<TRow>>,
): Promise<TRow[]> {
  const rows: TRow[] = [];
  const batches = postgrestFilterBatches(values);
  for (let offset = 0; offset < batches.length; offset += POSTGREST_BATCH_CONCURRENCY) {
    const window = batches.slice(offset, offset + POSTGREST_BATCH_CONCURRENCY);
    const results = await Promise.all(window.map((batch) => loadBatch(batch)));
    for (const { data, error } of results) {
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
    }
  }
  return rows;
}

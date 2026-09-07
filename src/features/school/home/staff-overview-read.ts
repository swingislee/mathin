import "server-only";
import type { createClient } from "@/lib/supabase/server";

export const STAFF_OVERVIEW_READ_LIMIT = 10_000;
const PAGE_SIZE = 200;

export interface OverviewRowsResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

interface OverviewQuery extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  order(column: string, options: { ascending: boolean }): OverviewQuery;
  range(from: number, to: number): OverviewQuery;
}

/** 小页读取并使用稳定排序，避免服务端单次行数上限静默截断统计。 */
export async function readOverviewRows<T>(buildQuery: () => OverviewQuery, order = ["id"]): Promise<OverviewRowsResult<T>> {
  const rows: T[] = [];
  for (let offset = 0; offset < STAFF_OVERVIEW_READ_LIMIT; offset += PAGE_SIZE) {
    let query = buildQuery();
    for (const column of order) query = query.order(column, { ascending: true });
    const result = await query.range(offset, offset + PAGE_SIZE - 1);
    if (result.error) return { data: null, error: result.error };
    if (result.data !== null && !Array.isArray(result.data)) return { data: null, error: { message: "OVERVIEW_INVALID_ROWS" } };
    const page = (result.data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}

/** 学期筛选沿用班级目录的授权 RPC；term_id 未开放直接列读取。 */
export async function readCurrentTermClassroomIds(
  supabase: Awaited<ReturnType<typeof createClient>>, termId: string | null,
): Promise<OverviewRowsResult<{ id: string }>> {
  if (!termId) return { data: null, error: { message: "CURRENT_TERM_UNAVAILABLE" } };
  const scopeResult = await supabase.rpc("resolve_classroom_scope", {});
  if (scopeResult.error) return { data: null, error: scopeResult.error };
  const access = scopeResult.data?.[0];
  if (!access) return { data: null, error: { message: "CLASSROOM_SCOPE_UNAVAILABLE" } };
  const scope = access.available_scopes.includes("all") ? "all" : access.resolved_scope;
  const rows: Array<{ id: string }> = [];
  for (let page = 1; rows.length < STAFF_OVERVIEW_READ_LIMIT; page += 1) {
    const result = await supabase.rpc("list_classrooms_for_scope", {
      p_scope: scope, p_filters: { schoolTermId: termId, purpose: "production" }, p_page: page,
    });
    if (result.error) return { data: null, error: result.error };
    const values = result.data ?? [];
    rows.push(...values.map(row => ({ id: row.id })));
    if (!values.length || rows.length >= (values[0]?.total_count ?? 0)) break;
  }
  return { data: rows, error: null };
}

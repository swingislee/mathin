import { beforeEach, expect, it, vi } from "vitest";
import { listLeadPool } from "@/features/school/leads";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, pages: [] as { table: string; start: number; end: number; ids: string[] }[], fail: false }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  let start = 0, end = 999, ids: string[] = [];
  const run = async () => {
    state.pages.push({ table, start, end, ids });
    if (state.fail && table === "lead_source_records" && start > 0) return { data: null, error: { message: "later page failed" }, count: null };
    // 模拟 REST 的硬上限：请求更大的 limit 也只能得到 1000 行。
    return { data: (state.tables[table] ?? []).filter(row => !ids.length || ids.includes(row.lead_id as string)).slice(start, Math.min(end + 1, start + 1000)), error: null, count: 1 };
  };
  const query = { select: () => query, order: () => query, eq: () => query, neq: () => query, not: () => query,
    in: (_field: string, values: string[]) => { ids = values; return query; }, range: (from: number, to: number) => { start = from; end = to; return query; },
    limit: (size: number) => { end = size - 1; return query; }, returns: run, then: (resolve: (value: unknown) => unknown) => run().then(resolve) };
  return query;
} }) }));

beforeEach(() => {
  state.pages = []; state.fail = false;
  state.tables = {
    collaborative_leads: [{ id: "visible-lead", provisional_student_name: "示例", phone: "", note: "", grade_hint: 3, grade_text: "", status: "uncontacted",
      owner_id: null, student_id: null, suggested_student_id: null, created_at: "2026-09-20T00:00:00Z", can_edit: true }],
    lead_source_records: Array.from({ length: 1001 }, (_, i) => ({ id: `source-${i}`, lead_id: "visible-lead", submitted_at: "2026-09-01T00:00:00Z", created_at: "2026-09-01T00:00:00Z" })),
    lead_interest_selections: [{ id: "interest", lead_id: "visible-lead", label: "数学" }],
    effective_lead_communications: Array.from({ length: 1001 }, (_, i) => ({ id: `contact-${i}`, lead_id: "visible-lead", note: "", outcome: "connected", occurred_at: null,
      wechat_added: i === 1000 ? true : null, visit_committed: null, interest_level: null })),
    lead_communications: Array.from({ length: 1001 }, (_, i) => ({ id: `contact-${i}`, lead_id: "visible-lead", occurred_on: "2026-03-01" })),
  };
});
it("enriches only visible page IDs without silently truncating source and communication history at 1000 rows", async () => {
  const result = await listLeadPool("actor", { scope: "all", page: 1, pageSize: 50 });
  expect(result.leads).toHaveLength(1);
  expect(result.leads[0]).toMatchObject({ sourceCount: 1001, contactCount: 1001, wechatAdded: true, lastContactAt: "2026-03-01" });
  for (const table of ["lead_source_records", "effective_lead_communications", "lead_communications"]) {
    expect(state.pages.filter(page => page.table === table).map(page => [page.start, page.end, page.ids]))
      .toEqual([[0, 999, ["visible-lead"]], [1000, 1999, ["visible-lead"]]]);
  }
});
it("rejects a later-page read error instead of showing incomplete contact counts", async () => {
  state.fail = true;
  await expect(listLeadPool("actor", { scope: "all", page: 1, pageSize: 50 })).rejects.toThrow("later page failed");
});

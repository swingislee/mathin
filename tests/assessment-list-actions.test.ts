import { beforeEach, expect, it, vi } from "vitest";
import { getAssessmentListDetailAction } from "@/features/school/assessment-list-actions";

const state = vi.hoisted(() => ({ user: { id: "actor" } as { id: string } | null, perms: new Set<string>(), record: null as unknown,
  read: vi.fn(), from: vi.fn(), queries: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getMyPerms: async () => state.perms }));
vi.mock("@/features/school/assessment-workbench-data", () => ({ listAssessmentWorkbenchRows: state.read }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, from: state.from }) }));
const id = "12345678-1234-4123-8123-123456789012", key = `registration:${id}`;
beforeEach(() => {
  state.user = { id: "actor" }; state.perms = new Set(["followup.view"]); state.record = null; state.queries = []; state.read.mockReset();
  state.from.mockReset().mockImplementation((table: string) => {
    state.queries.push(table); const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: state.record, error: null }) }; return query;
  });
});
it("validates keys and requires a verified user and an assessment permission before reading", async () => {
  expect(await getAssessmentListDetailAction(`${key}:forged`)).toEqual({ ok: false, code: "VALIDATION" });
  state.user = null; expect(await getAssessmentListDetailAction(key)).toEqual({ ok: false, code: "UNAUTHENTICATED" });
  state.user = { id: "actor" }; state.perms.clear(); expect(await getAssessmentListDetailAction(key)).toEqual({ ok: false, code: "FORBIDDEN" });
  expect(state.from).not.toHaveBeenCalled(); expect(state.read).not.toHaveBeenCalled();
});
it("uses only the subject returned by RLS and refuses invisible or mismatched rows", async () => {
  expect(await getAssessmentListDetailAction(key)).toEqual({ ok: false, code: "NOT_FOUND" }); expect(state.read).not.toHaveBeenCalled();
  state.record = { student_id: null, lead_id: "visible-lead", leads: { student_id: "linked-student" } }; state.read.mockResolvedValue([]);
  expect(await getAssessmentListDetailAction(key)).toEqual({ ok: false, code: "NOT_FOUND" });
  expect(state.read).toHaveBeenCalledWith({ studentId: "linked-student", leadId: "visible-lead" });
  const row = { id: key }; state.read.mockResolvedValue([row]);
  expect(await getAssessmentListDetailAction(key)).toEqual({ ok: true, data: row });
});

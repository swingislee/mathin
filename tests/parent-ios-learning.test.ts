import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/v1/parent/learning/route";
import { portalGet } from "@/features/parent-portal/server";
import { learningNotificationLink } from "@/features/parent-portal/learning-contract";
import type { ParentLearning } from "../contracts/parent-api/portal";

type Result = { data: unknown; error: { message: string; code?: string } | null };
const state = vi.hoisted(() => ({
  rpc: vi.fn<(name: string, args?: unknown) => Promise<Result>>(),
  getUser: vi.fn(), from: vi.fn(), profile: {} as Record<string, unknown>,
  results: {} as Record<string, Result>, notifications: [] as Record<string, unknown>[],
  filters: [] as unknown[][], createClient: vi.fn(), admin: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: state.createClient }));
vi.mock("@/lib/supabase/config", () => ({ getSupabaseConfig: () => ({ url: "https://supabase.example.invalid", key: "public-key-placeholder" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: state.admin }));

const child = "11111111-1111-4111-8111-111111111111";
const sibling = "22222222-2222-4222-8222-222222222222";
const actor = "33333333-3333-4333-8333-333333333333";
const session = "44444444-4444-4444-8444-444444444444";
const classroom = "55555555-5555-4555-8555-555555555555";
const notice = "66666666-6666-4666-8666-666666666666";
const requestId = "77777777-7777-4777-8777-777777777777";
const now = "2026-10-01T04:00:00.000Z";
const ok = (data: unknown): Result => ({ data, error: null });
const fail = (message: string, code?: string): Result => ({ data: null, error: { message, code } });
const getRequest = (query = `participant=${child}`, authenticated = true) => new Request(`https://app.example.invalid/api/v1/parent/learning?${query}`, {
  headers: authenticated ? { authorization: "Bearer test-only-token" } : {},
});
const postRequest = (body: unknown) => new Request("https://app.example.invalid/api/v1/parent/learning", {
  method: "POST", headers: { authorization: "Bearer test-only-token", "content-type": "application/json" }, body: JSON.stringify(body),
});
function report(id: string, participantId?: string) {
  return { id, kind: "assessment", title: "已发送测评", participantId, participantName: "同名孩子", date: now,
    summary: "老师观察", strengths: "", focusAreas: "", recommendation: "", score: 3, totalScore: 5 };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  state.profile = { role: "parent", account_status: "active", password_change_required: false, display_name: "开发家长" };
  state.results = {
    has_current_required_consents: ok(true), get_my_students: ok([{ id: child, name: "同名孩子" }, { id: sibling, name: "同名孩子" }]),
    get_my_schedule: ok([]), get_my_attendance: ok([]), get_my_learning_summary: ok([]),
    list_my_session_leave_requests: ok([]), miniapp_assessment_reports: ok([]), get_my_session_reviews: ok([]),
    mark_notification_read: ok(true), submit_session_leave_request: ok(requestId),
  };
  state.notifications = [];
  state.filters = [];
  state.rpc.mockImplementation(async (name) => {
    if (!(name in state.results)) throw new Error(`Unexpected RPC: ${name}`);
    return state.results[name];
  });
  state.getUser.mockResolvedValue({ data: { user: { id: actor } }, error: null });
  state.from.mockImplementation((table: string) => {
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { state.filters.push([table, "eq", key, value]); return query; },
      is: (key: string, value: unknown) => { state.filters.push([table, "is", key, value]); return query; },
      order: () => query,
      limit: async (value: number) => { state.filters.push([table, "limit", value]); return ok(state.notifications); },
      maybeSingle: async () => ok(state.profile),
    };
    return query;
  });
  state.createClient.mockReturnValue({ auth: { getUser: state.getUser }, rpc: state.rpc, from: state.from });
  state.admin.mockImplementation(() => { throw new Error("Learning endpoints must use the caller's client"); });
});
afterEach(() => vi.useRealTimers());

describe("iOS 家长学习 HTTP 合同", () => {
  it("使用 Bearer + getUser，并在匿名或账号安全门失败时停止", async () => {
    expect((await GET(getRequest(undefined, false))).status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
    state.profile.account_status = "suspended";
    const denied = await GET(getRequest());
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ code: "ACCOUNT_SECURITY" });
    expect(state.getUser).toHaveBeenCalledWith("test-only-token");
    expect(state.createClient).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: "Bearer test-only-token" } },
    }));
  });

  it("未关联孩子在读取业务数据前被拒绝", async () => {
    state.results.get_my_students = ok([{ id: sibling, name: "同名孩子" }]);
    const result = await GET(getRequest());
    expect(result.status).toBe(403);
    expect(await result.json()).toEqual({ code: "FORBIDDEN" });
    expect(state.rpc.mock.calls.map(([name]) => name)).toEqual(["has_current_required_consents", "get_my_students"]);
    expect(state.from.mock.calls.map(([name]) => name)).toEqual(["profiles"]);
  });

  it("同名孩子按 ID 隔离；窗口课程只聚合真实课次，通知只读本人并限制字段", async () => {
    const base = { session_id: session, classroom_id: classroom, classroom_name: "数学探索", lecture_name: "图形观察", duration_min: 90, teacher_name: "授课老师" };
    state.results.get_my_schedule = ok([
      { ...base, student_id: child, scheduled_at: "2026-10-03T02:00:00Z" },
      { ...base, student_id: child, session_id: requestId, scheduled_at: "2026-09-30T02:00:00Z" },
      { ...base, student_id: sibling, classroom_id: notice, scheduled_at: "2026-10-02T02:00:00Z" },
    ]);
    state.results.get_my_attendance = ok([{ ...base, student_id: child, scheduled_at: now, status: "late", note: "" }, { ...base, student_id: sibling, scheduled_at: now, status: "present", note: "另一孩子" }]);
    state.results.get_my_learning_summary = ok([{ student_id: child, grade: null, next_session_at: "2026-10-03T02:00:00Z", week_session_count: 1, star_total: 8, payment_status: "overdue", recent_submissions: [{ score: 99 }] }]);
    state.results.miniapp_assessment_reports = ok([report("child-report", child), report("sibling-report", sibling), report("legacy-report")]);
    state.notifications = [{ id: notice, notification_key: "assignment.published", occurred_at: now, read_at: null,
      deep_link: `/dashboard/children?child=${sibling}`, payload: { studentId: sibling, studentName: "同名孩子", classroomName: "数学探索", sessionTitle: "图形观察", privateRemark: "不输出" } }];
    const response = await GET(getRequest());
    const body: ParentLearning = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body.schedule.map((item) => item.participantId)).toEqual([child, child]);
    expect(body.courses).toEqual([{ id: classroom, name: "数学探索", teacherName: "授课老师", nextSessionAt: "2026-10-03T02:00:00Z", sessionCount: 2 }]);
    expect(body.attendance.map((item) => item.participantId)).toEqual([child]);
    expect(body.reports.map((item) => item.id)).toEqual(["child-report"]);
    expect(body.unassignedReportCount).toBe(1);
    expect(body.summary).toEqual({ grade: null, nextSessionAt: "2026-10-03T02:00:00Z", weekSessionCount: 1, starTotal: 8 });
    expect(body.notifications[0].participantId).toBe(sibling);
    expect(body.notifications[0]).not.toHaveProperty("payload");
    expect(state.filters).toContainEqual(["notifications", "eq", "recipient_id", actor]);
    expect(state.filters).toContainEqual(["notifications", "is", "archived_at", null]);
    expect(state.filters).toContainEqual(["notifications", "limit", 100]);
    expect(body.capabilities).toMatchObject({ chat: false, rescheduling: false, wrongAnswers: false, payments: false });
    expect(state.admin).not.toHaveBeenCalled();
    const api = JSON.parse(readFileSync("contracts/parent-api/openapi.json", "utf8"));
    expect(Object.keys(body).sort()).toEqual(api.components.schemas.ParentLearning.required.sort());
    expect(Object.keys(body.notifications[0]).sort()).toEqual(api.components.schemas.LearningNotification.required.sort());
  });

  it("原 reports 端点保留旧报告并把缺少归属显式返回 null，反馈使用 student_id", async () => {
    state.results.miniapp_assessment_reports = ok([report("legacy-report")]);
    state.results.get_my_session_reviews = ok([{ session_id: session, student_id: child, student_name: "同名孩子", lecture_name: "课后反馈", scheduled_at: now, comment: "课堂反馈", exit_score: null }]);
    const response = await portalGet(new Request("https://app.example.invalid/api/v1/parent/portal?resource=reports", { headers: { authorization: "Bearer test-only-token" } }));
    const rows = await response.json();
    expect(rows.find((row: { id: string }) => row.id === "legacy-report").participantId).toBeNull();
    expect(rows.find((row: { kind: string }) => row.kind === "feedback").participantId).toBe(child);
  });

  it("报告 scope 无可见行时保留空结果，查询错误返回失败而非空数据", async () => {
    expect((await (await GET(getRequest())).json()).reports).toEqual([]);
    state.results.get_my_schedule = fail("database unavailable");
    const failed = await GET(getRequest());
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ code: "UNAVAILABLE" });
    state.results.get_my_schedule = fail("permission denied", "42501");
    expect((await GET(getRequest())).status).toBe(403);
  });

  it.each([
    "", "participant=not-a-uuid", `participant=${child}&extra=unsupported`,
    `participant=${child}&from=2026-10-01&to=2026-10-02`,
    `participant=${child}&from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z`,
    `participant=${child}&from=2025-01-01T00:00:00Z&to=2026-10-01T00:00:00Z`,
  ])("拒绝无效查询 %s", async (query) => {
    expect((await GET(getRequest(query))).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("请假沿用本人孩子及原业务 RPC，只返回申请提交结果", async () => {
    const response = await POST(postRequest({ action: "leave", participantId: child, sessionId: session, reason: "  家庭安排  " }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: requestId });
    expect(state.rpc).toHaveBeenCalledWith("submit_session_leave_request", { p_student_id: child, p_session_id: session, p_reason: "家庭安排" });
    state.results.get_my_students = ok([]);
    state.rpc.mockClear();
    expect((await POST(postRequest({ action: "leave", participantId: child, sessionId: session, reason: "家庭安排" }))).status).toBe(403);
    expect(state.rpc.mock.calls.some(([name]) => name === "submit_session_leave_request")).toBe(false);
  });

  it.each([["SESSION_NOT_LEAVABLE", 409], ["SESSION_NOT_FOUND", 404], ["STUDENT_NOT_ENROLLED", 403]])("保留请假失败语义 %s", async (message, status) => {
    state.results.submit_session_leave_request = fail(message as string);
    expect((await POST(postRequest({ action: "leave", participantId: child, sessionId: session, reason: "家庭安排" }))).status).toBe(status);
  });

  it("已读通过本人 RPC，拒绝他人/归档通知且不假报成功", async () => {
    expect(await (await POST(postRequest({ action: "readNotification", id: notice }))).json()).toEqual({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith("mark_notification_read", { p_notification_id: notice });
    state.results.mark_notification_read = fail("NOT_FOUND");
    expect((await POST(postRequest({ action: "readNotification", id: notice }))).status).toBe(404);
    state.results.mark_notification_read = ok(false);
    expect((await POST(postRequest({ action: "readNotification", id: notice }))).status).toBe(404);
  });

  it("只接收实际支持的命令及有界输入", async () => {
    for (const body of [
      { action: "chat", text: "hello" },
      { action: "leave", participantId: child, sessionId: session, reason: " " },
      { action: "leave", participantId: child, sessionId: session, reason: "字".repeat(1001) },
      { action: "readNotification", id: notice, recipientId: sibling },
    ]) expect((await POST(postRequest(body))).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("通知目标只保留本站工作区路径", () => {
    expect(learningNotificationLink(`/zh/dashboard/children?child=${child}#leave`)).toBe(`/zh/dashboard/children?child=${child}#leave`);
    for (const link of ["https://outside.invalid", "//outside.invalid", "/\\outside.invalid", "javascript:alert(1)", "/dashboard\nwrong", "/api/v1/parent/auth"])
      expect(learningNotificationLink(link)).toBeNull();
  });
});

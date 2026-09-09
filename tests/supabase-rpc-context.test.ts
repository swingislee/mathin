import { AuthSessionMissingError, createClient, type User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logout } from "@/app/[locale]/(auth)/actions";
import { startClassSession } from "@/features/classroom/actions";
import { getAttendanceDrawerData } from "@/features/school/actions/attendance";
import { getTodaySessionOperations } from "@/features/school/teacher-session-operations";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  permissions: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/auth", () => ({ getMyPerms: mocks.permissions }));
vi.mock("@/features/school/actions/schedule", () => ({ getWeekSchedule: mocks.schedule }));
vi.mock("@/features/school/organization-locations", () => ({ getOrganizationTimezoneV2: async () => "Asia/Shanghai" }));
vi.mock("@/features/school/organization-settings", () => ({ isFeatureEnabled: async () => false }));
vi.mock("@/features/school/courses", () => ({ getSessionCoursewareTemplate: vi.fn() }));
vi.mock("@/features/courseware-studio/data", () => ({ materializeSessionResolved: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));

const SESSION_ID = "00000000-0000-4000-8000-000000000001";
const STUDENT_ID = "00000000-0000-4000-8000-000000000002";
const CLASSROOM_ID = "00000000-0000-4000-8000-000000000003";
const MICROCOURSE_ID = "00000000-0000-4000-8000-000000000004";
const attendance = [{
  studentId: STUDENT_ID, studentName: "开发学生", status: "late", note: "",
  marked: true, historyMismatch: false,
}];
const frozenRoster = {
  sessionId: SESSION_ID, revision: 1, frozen: true,
  sourceHash: "a".repeat(64), currentSourceHash: "a".repeat(64), hasDifference: false,
  frozenAt: "2026-09-09T01:00:00Z", revisionCreatedAt: "2026-09-09T01:00:00Z",
  starEventSchema: 1, entries: [],
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  mocks.permissions.mockResolvedValue(new Set(["attendance.mark"]));
  mocks.schedule.mockResolvedValue([{
    sessionId: SESSION_ID, classroomId: CLASSROOM_ID, scheduledAt: "2026-09-09T01:00:00Z",
  }]);
});

function setupClient() {
  const requests: Array<{ path: string; body: unknown }> = [];
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    requests.push({ path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
    switch (url.pathname) {
      case "/rest/v1/rpc/revoke_all_my_web_push_subscriptions": return Response.json(1);
      case "/rest/v1/rpc/get_session_attendance_roster_v2": return Response.json(attendance);
      case "/rest/v1/rpc/freeze_session_roster": return Response.json(frozenRoster);
      case "/rest/v1/rpc/freeze_selected_teacher_microcourse_source_session": return Response.json({ frozen: true });
      case "/rest/v1/class_sessions": return Response.json([{
        id: SESSION_ID, classroom_id: CLASSROOM_ID, lecture_id: null, courseware_overlay: [],
        courseware_frozen_at: null, started_at: null, ended_at: null, deleted_at: null,
        cancelled_by: null, voided_at: null, selected_teacher_microcourse_id: MICROCOURSE_ID,
      }]);
      case "/rest/v1/enrollments":
      case "/rest/v1/session_attendance": return Response.json([]);
      default: throw new Error(`Unexpected request: ${url.pathname}`);
    }
  });
  // 使用真实 SDK 的 rpc 和 PostgREST builder，保留 this 依赖及 PromiseLike 行为。
  // 所有 HTTP 由内存 transport 响应，测试不连接开发库或生产库。
  const client = createClient("https://supabase.example.test", "test-publishable-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: transport },
  });
  const user: User = {
    id: STUDENT_ID, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-09-09T00:00:00Z",
  };
  vi.spyOn(client.auth, "getUser").mockResolvedValue({ data: { user }, error: null });
  const signOut = vi.spyOn(client.auth, "signOut").mockResolvedValue({ error: null });
  mocks.createClient.mockResolvedValue(client);
  return { client, signOut, requests, transport };
}

function logoutForm(locale: string) {
  const form = new FormData();
  form.set("locale", locale);
  return form;
}

describe("退出登录的通知清理与会话退出", () => {
  it.each(["zh", "en"])("%s 撤销通知后执行退出并返回首页", async (locale) => {
    const { requests, signOut, transport } = setupClient();
    await expect(logout(logoutForm(locale))).rejects.toThrow(`REDIRECT:/${locale}`);
    expect(requests).toEqual([{ path: "/rest/v1/rpc/revoke_all_my_web_push_subscriptions", body: {} }]);
    expect(signOut).toHaveBeenCalledOnce();
    expect(transport.mock.invocationCallOrder[0]).toBeLessThan(signOut.mock.invocationCallOrder[0]);
  });

  it("通知服务返回错误时仍完成退出", async () => {
    const { signOut, transport } = setupClient();
    transport.mockResolvedValueOnce(Response.json({ message: "notification unavailable", code: "503" }, { status: 503 }));
    await expect(logout(logoutForm("zh"))).rejects.toThrow("REDIRECT:/zh");
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("通知调用同步异常时仍完成退出", async () => {
    const { client, signOut } = setupClient();
    vi.spyOn(client, "rpc").mockImplementationOnce(() => { throw new Error("notification unavailable"); });
    await expect(logout(logoutForm("zh"))).rejects.toThrow("REDIRECT:/zh");
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("通知请求拒绝时仍完成退出", async () => {
    const { client, signOut, transport } = setupClient();
    const failingRequest = client.rpc("revoke_all_my_web_push_subscriptions").throwOnError();
    mocks.createClient.mockResolvedValueOnce({ rpc: () => failingRequest, auth: client.auth });
    transport.mockRejectedValueOnce(new Error("notification unavailable"));
    await expect(logout(logoutForm("zh"))).rejects.toThrow("REDIRECT:/zh");
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("会话退出本身抛错时保留错误结果", async () => {
    const { signOut } = setupClient();
    signOut.mockRejectedValueOnce(new Error("signout failed"));
    await expect(logout(logoutForm("zh"))).rejects.toThrow("signout failed");
  });
});

describe("课次与点名的 Supabase 客户端上下文", () => {
  it("点名抽屉读取真实 RPC builder 返回的花名册", async () => {
    const { requests } = setupClient();
    await expect(getAttendanceDrawerData(SESSION_ID)).resolves.toEqual({ ok: true, data: attendance });
    expect(requests).toEqual([{
      path: "/rest/v1/rpc/get_session_attendance_roster_v2", body: { p_session_id: SESSION_ID },
    }]);
  });

  it("点名读取保持登录、权限和输入校验", async () => {
    const { client, requests } = setupClient();
    await expect(getAttendanceDrawerData("invalid")).resolves.toEqual({ ok: false, code: "VALIDATION" });
    mocks.permissions.mockResolvedValueOnce(new Set());
    await expect(getAttendanceDrawerData(SESSION_ID)).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    vi.spyOn(client.auth, "getUser").mockResolvedValueOnce({ data: { user: null }, error: new AuthSessionMissingError() });
    await expect(getAttendanceDrawerData(SESSION_ID)).resolves.toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(requests).toEqual([]);
  });

  it("今日课次有排课时成功读取点名统计", async () => {
    const { requests } = setupClient();
    const result = await getTodaySessionOperations(new Date("2026-09-09T00:30:00Z"));
    expect(result.sessions).toEqual([expect.objectContaining({
      sessionId: SESSION_ID, rosterCount: 1, attendanceRecordedCount: 1, attendanceComplete: true,
      attendanceByStatus: { present: 0, absent: 0, late: 1, leave: 0 },
    })]);
    expect(requests).toContainEqual({
      path: "/rest/v1/rpc/get_session_attendance_roster_v2", body: { p_session_id: SESSION_ID },
    });
  });

  it("选定微课开课时冻结微课并保留花名册结果", async () => {
    const { requests } = setupClient();
    await expect(startClassSession(SESSION_ID)).resolves.toEqual(frozenRoster);
    expect(requests.filter((request) => request.path.includes("/rpc/"))).toEqual([
      { path: "/rest/v1/rpc/freeze_session_roster", body: { p_session_id: SESSION_ID, p_star_event_schema: 1 } },
      { path: "/rest/v1/rpc/freeze_selected_teacher_microcourse_source_session", body: { p_session_id: SESSION_ID } },
    ]);
  });
});

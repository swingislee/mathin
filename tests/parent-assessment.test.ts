import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/v1/parent/assessments/route";
import { GET as GET_SLOTS } from "@/app/api/v1/parent/assessment-slots/route";
import type { AssessmentCommand, ParentAssessmentOverview, ParentAssessmentRequest } from "../contracts/parent-api/portal";

type Result = { data: unknown; error: { message: string; code?: string } | null };
const state = vi.hoisted(() => ({
  rpc: vi.fn<(name: string, args?: unknown) => Promise<Result>>(),
  getUser: vi.fn(), from: vi.fn(), createClient: vi.fn(), admin: vi.fn(),
  profile: {} as Record<string, unknown>, results: {} as Record<string, Result>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: state.createClient }));
vi.mock("@/lib/supabase/config", () => ({ getSupabaseConfig: () => ({ url: "https://supabase.example.invalid", key: "public-key-placeholder" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: state.admin }));

const child = "11111111-1111-4111-8111-111111111111";
const sibling = "22222222-2222-4222-8222-222222222222";
const actor = "33333333-3333-4333-8333-333333333333";
const teacher = "44444444-4444-4444-8444-444444444444";
const invitation = "55555555-5555-4555-8555-555555555555";
const otherInvitation = "66666666-6666-4666-8666-666666666666";
const slot = "77777777-7777-4777-8777-777777777777";
const campus = "88888888-8888-4888-8888-888888888888";
const option = "2026-10-03@10:00";
const updatedAt = "2026-10-01T04:00:00.123456+00:00";
const ok = (data: unknown): Result => ({ data, error: null });
const fail = (message: string, code?: string): Result => ({ data: null, error: { message, code } });
const getRequest = (query = `participant=${child}`, authenticated = true) => new Request(`https://app.example.invalid/api/v1/parent/assessments?${query}`, {
  headers: authenticated ? { authorization: "Bearer test-only-token" } : {},
});
const postRequest = (body: unknown) => new Request("https://app.example.invalid/api/v1/parent/assessments", {
  method: "POST", headers: { authorization: "Bearer test-only-token", "content-type": "application/json" }, body: JSON.stringify(body),
});
const requestCommand = (): AssessmentCommand => ({ action: "request", id: invitation, participantId: child, teacherId: teacher, parentTimeOptions: [option] });
const confirmCommand = (): AssessmentCommand => ({ action: "confirm", id: invitation, participantId: child, timeOption: option, expectedUpdatedAt: updatedAt });
const requestRow = (overrides: Partial<ParentAssessmentRequest> = {}): ParentAssessmentRequest => ({
  id: invitation, participantId: child, teacher: { id: teacher, displayName: "测评老师" }, state: "awaiting_teacher",
  parentTimeOptions: [option], teacherTimeOptions: [], sharedTimeOptions: [],
  proposedStartsAt: null, scheduledAt: null, updatedAt, canConfirm: false, ...overrides,
});
const overview = (requests: ParentAssessmentRequest[] = []): ParentAssessmentOverview => ({
  participantId: child, timeZone: "Asia/Shanghai", eligibility: { canRequest: requests.length === 0, reason: requests.length ? "ACTIVE_INVITATION" : null },
  teachers: [{ id: teacher, displayName: "测评老师" }], requests,
});

beforeEach(() => {
  vi.clearAllMocks();
  state.profile = { role: "parent", account_status: "active", password_change_required: false, display_name: "开发家长" };
  state.results = {
    has_current_required_consents: ok(true), parent_assessment_overview: ok(overview()),
    request_parent_assessment: ok(requestRow()),
    confirm_parent_assessment: ok(requestRow({ state: "confirmed", scheduledAt: "2026-10-03T02:00:00+00:00" })),
  };
  state.rpc.mockImplementation(async (name) => {
    if (!(name in state.results)) throw new Error(`Unexpected RPC: ${name}`);
    return state.results[name];
  });
  state.getUser.mockResolvedValue({ data: { user: { id: actor } }, error: null });
  state.from.mockImplementation(() => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ok(state.profile) };
    return query;
  });
  state.createClient.mockReturnValue({ auth: { getUser: state.getUser }, rpc: state.rpc, from: state.from });
  state.admin.mockImplementation(() => { throw new Error("Assessment endpoints must use the caller's client"); });
});

describe("家长独立 1 对 1 测评 HTTP 合同", () => {
  const availability = () => ({ participantId: child, timeZone: "Asia/Shanghai", from: "2026-10-01", to: "2026-10-14",
    teachers: [{ id: teacher, displayName: "测评老师", privatePhone: "private" }], campuses: [{ id: campus, name: "校区" }],
    slots: [{ id: slot, teacherId: teacher, campusId: campus, startsAt: "2026-10-03T07:00:00Z", endsAt: "2026-10-03T07:40:00Z", available: true, privateBookingId: invitation }] });
  const slotRequest = (query = `participant=${child}&subjects=math,english&grade=3`, authenticated = true) => new Request(`https://app.example.invalid/api/v1/parent/assessment-slots?${query}`, { headers: authenticated ? { authorization: "Bearer test-only-token" } : {} });
  const bookCommand = () => ({ action: "book", id: invitation, participantId: child, slotId: slot, subjects: ["math", "english"], grade: 3, mode: "campus" });
  const booked = () => requestRow({ state: "confirmed", parentTimeOptions: [], scheduledAt: "2026-10-03T07:00:00Z",
    booking: { slotId: slot, subjects: ["math", "english"], grade: 3, mode: "campus", campus: { id: campus, name: "校区" }, endsAt: "2026-10-03T07:40:00Z" } });

  it("发布时段查询按学员、全部所选科目与年级授权，过滤内部预约资料", async () => {
    state.results.parent_assessment_availability = ok(availability());
    expect((await GET_SLOTS(slotRequest(undefined, false))).status).toBe(401);
    const result = await GET_SLOTS(slotRequest());
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await result.json();
    expect(body.slots[0]).not.toHaveProperty("privateBookingId");
    expect(body.teachers[0]).not.toHaveProperty("privatePhone");
    expect(state.rpc).toHaveBeenCalledWith("parent_assessment_availability", { p_student_id: child, p_subjects: ["math", "english"], p_grade: 3 });
    expect(state.admin).not.toHaveBeenCalled();
  });

  it("拒绝重复/缺失科目、空年级及不属于当前孩子的时段投影", async () => {
    for (const query of [`participant=${child}&subjects=math&grade=`, `participant=${child}&subjects=math,math&grade=3`,
      `participant=${child}&subjects=math&grade=3&grade=4`, `participant=${child}&grade=3`]) {
      expect((await GET_SLOTS(slotRequest(query))).status).toBe(400);
    }
    expect(state.rpc).not.toHaveBeenCalled();
    for (const value of [{ ...availability(), participantId: sibling }, { ...availability(), teachers: [] },
      { ...availability(), to: "2026-10-13" }, { ...availability(), slots: [{ ...availability().slots[0], endsAt: "2026-10-03T06:00:00Z" }] }]) {
      state.results.parent_assessment_availability = ok(value);
      expect((await GET_SLOTS(slotRequest())).status).toBe(503);
    }
  });

  it("预约仅传发布时段和选择信息，幂等重试接受已取消状态并保留业务冲突", async () => {
    state.results.book_parent_assessment_slot = ok(booked());
    const result = await POST(postRequest(bookCommand()));
    expect(result.status).toBe(201); expect(await result.json()).toEqual(booked());
    expect(state.rpc).toHaveBeenCalledWith("book_parent_assessment_slot", { p_request_id: invitation, p_student_id: child, p_slot_id: slot, p_subjects: ["math", "english"], p_grade: 3 });
    state.results.book_parent_assessment_slot = ok({ ...booked(), state: "cancelled", scheduledAt: null });
    expect((await POST(postRequest(bookCommand()))).status).toBe(201);
    for (const message of ["SLOT_UNAVAILABLE", "CAMPUS_UNAVAILABLE"]) {
      state.results.book_parent_assessment_slot = fail(message);
      expect((await POST(postRequest(bookCommand()))).status).toBe(409);
    }
  });

  it("预约响应必须匹配原时段和科目年级，客户端不能改教师或状态", async () => {
    for (const body of [{ ...bookCommand(), teacherId: teacher }, { ...bookCommand(), state: "confirmed" },
      { ...bookCommand(), subjects: ["math", "math"] }, { ...bookCommand(), grade: 13 }, { ...bookCommand(), mode: "online" }]) {
      expect((await POST(postRequest(body))).status).toBe(400);
    }
    expect(state.rpc).not.toHaveBeenCalled();
    for (const value of [requestRow(), { ...booked(), booking: { ...booked().booking, subjects: ["math"] } },
      { ...booked(), booking: { ...booked().booking, slotId: otherInvitation } }]) {
      state.results.book_parent_assessment_slot = ok(value);
      expect((await POST(postRequest(bookCommand()))).status).toBe(503);
    }
  });

  it("以 Bearer + getUser 检查登录和账号安全门，匿名及员工不能调用", async () => {
    expect((await GET(getRequest(undefined, false))).status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
    state.profile.role = "staff";
    expect((await GET(getRequest())).status).toBe(403);
    state.profile.role = "parent";
    state.profile.account_status = "suspended";
    const denied = await GET(getRequest());
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ code: "ACCOUNT_SECURITY" });
    state.profile.account_status = "active";
    state.results.has_current_required_consents = ok(false);
    expect(await (await GET(getRequest())).json()).toEqual({ code: "ACCOUNT_SECURITY" });
    expect(state.rpc.mock.calls.some(([name]) => name === "parent_assessment_overview")).toBe(false);
    expect(state.getUser).toHaveBeenCalledWith("test-only-token");
    expect(state.createClient).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({
      global: { headers: { Authorization: "Bearer test-only-token" } },
    }));
  });

  it("只调用按参与人授权的专用概览 RPC，教师与邀约字段按白名单返回", async () => {
    const record = { ...requestRow(), leadId: "private-lead", parent_request_payload: { internal: true } };
    state.results.parent_assessment_overview = ok({
      ...overview([record]), privateNotes: "内部备注占位",
      teachers: [{ id: teacher, displayName: "测评老师", phone: "private-placeholder" }],
    });
    const response = await GET(getRequest());
    const body: ParentAssessmentOverview = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(state.rpc).toHaveBeenCalledWith("parent_assessment_overview", { p_student_id: child });
    expect(state.rpc.mock.calls.map(([name]) => name)).toEqual(["has_current_required_consents", "parent_assessment_overview"]);
    expect(state.from.mock.calls.map(([table]) => table)).toEqual(["profiles"]);
    expect(state.admin).not.toHaveBeenCalled();
    expect(body).not.toHaveProperty("privateNotes");
    expect(body.teachers[0]).toEqual({ id: teacher, displayName: "测评老师" });
    expect(body.requests[0]).toEqual(requestRow());
    const api = JSON.parse(readFileSync("contracts/parent-api/openapi.json", "utf8"));
    expect(Object.keys(body).sort()).toEqual([...api.components.schemas.ParentAssessmentOverview.required].sort());
    expect(Object.keys(body.requests[0]).sort()).toEqual([...api.components.schemas.ParentAssessmentRequest.required].sort());
    expect(api.paths["/api/v1/parent/assessments"].get.security).toEqual([{ parentBearer: [] }]);
  });

  it("当前孩子权限撤销返回 FORBIDDEN；RPC 缺失返回不可用并保留空数据的真实含义", async () => {
    state.results.parent_assessment_overview = fail("FORBIDDEN");
    expect(await (await GET(getRequest())).json()).toEqual({ code: "FORBIDDEN" });
    state.results.parent_assessment_overview = fail("Could not find the function", "PGRST202");
    const missing = await GET(getRequest());
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ code: "UNAVAILABLE" });
    state.results.parent_assessment_overview = ok({
      ...overview(), eligibility: { canRequest: false, reason: "NO_ELIGIBLE_TEACHER" }, teachers: [],
    });
    const empty = await GET(getRequest());
    expect(empty.status).toBe(200);
    expect((await empty.json()).teachers).toEqual([]);
  });

  it("同名孩子仍按 UUID 隔离，RPC 返回另一孩子时整次响应失败", async () => {
    state.results.parent_assessment_overview = ok({ ...overview(), participantId: sibling });
    expect((await GET(getRequest())).status).toBe(503);
    state.results.parent_assessment_overview = ok(overview([requestRow({ participantId: sibling })]));
    expect((await GET(getRequest())).status).toBe(503);
    state.results.request_parent_assessment = ok(requestRow({ participantId: sibling }));
    expect((await POST(postRequest(requestCommand()))).status).toBe(503);
    state.results.request_parent_assessment = ok(requestRow({ id: otherInvitation }));
    expect((await POST(postRequest(requestCommand()))).status).toBe(503);
  });

  it("原生端的大写 UUID 在查询、申请和确认时统一规范化", async () => {
    const canonicalChild = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const canonicalTeacher = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const canonicalInvitation = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const row = requestRow({ id: canonicalInvitation, participantId: canonicalChild, teacher: { id: canonicalTeacher, displayName: "测评老师" } });
    state.results.parent_assessment_overview = ok({ ...overview(), participantId: canonicalChild });
    const read = await GET(getRequest(`participant=${canonicalChild.toUpperCase()}`));
    expect(read.status).toBe(200);
    expect((await read.json()).participantId).toBe(canonicalChild);
    expect(state.rpc).toHaveBeenCalledWith("parent_assessment_overview", { p_student_id: canonicalChild });
    state.results.request_parent_assessment = ok(row);
    const requested = await POST(postRequest({ ...requestCommand(),
      id: canonicalInvitation.toUpperCase(), participantId: canonicalChild.toUpperCase(), teacherId: canonicalTeacher.toUpperCase(),
    }));
    expect(requested.status).toBe(201);
    expect(await requested.json()).toEqual(row);
    expect(state.rpc).toHaveBeenCalledWith("request_parent_assessment", {
      p_request_id: canonicalInvitation, p_student_id: canonicalChild, p_assessor_id: canonicalTeacher, p_parent_time_options: [option],
    });
    state.results.confirm_parent_assessment = ok({ ...row, state: "confirmed", scheduledAt: "2026-10-03T02:00:00Z" });
    expect((await POST(postRequest({ ...confirmCommand(), id: canonicalInvitation.toUpperCase(), participantId: canonicalChild.toUpperCase() }))).status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("confirm_parent_assessment", {
      p_invitation_id: canonicalInvitation, p_student_id: canonicalChild, p_time_option: option, p_expected_updated_at: updatedAt,
    });
  });

  it.each([
    "", "participant=not-a-uuid", `participant=${child}&extra=unsupported`, `participant=${child}&participant=${sibling}`,
  ])("拒绝缺失、畸形或含糊查询 %s", async (query) => {
    expect((await GET(getRequest(query))).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("申请透传稳定客户端 UUID 和真实教师，响应仍是等待教师", async () => {
    const body = { ...requestCommand(), parentTimeOptions: ["2026-10-04@after_school", option] };
    const first = await POST(postRequest(body));
    const retry = await POST(postRequest(body));
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual(requestRow());
    expect(retry.status).toBe(201);
    expect(state.rpc).toHaveBeenCalledWith("request_parent_assessment", {
      p_request_id: invitation, p_student_id: child, p_assessor_id: teacher,
      p_parent_time_options: ["2026-10-04@after_school", option],
    });
    expect(state.rpc.mock.calls.filter(([name]) => name === "request_parent_assessment")).toHaveLength(2);
    expect(state.admin).not.toHaveBeenCalled();
  });

  it("申请重试接受已由业务推进的当前状态，不以当前时刻拒绝历史幂等恢复", async () => {
    const oldOption = "2020-01-01@10:00";
    const current = requestRow({ state: "completed", parentTimeOptions: [oldOption], scheduledAt: "2020-01-01T02:00:00Z" });
    state.results.request_parent_assessment = ok(current);
    const response = await POST(postRequest({ ...requestCommand(), parentTimeOptions: [oldOption] }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(current);
  });

  it("确认使用同一邀约及原样数据库版本，不把等待家长的提议当成预约", async () => {
    const proposed = requestRow({ state: "awaiting_parent", teacherTimeOptions: [option], sharedTimeOptions: [option], proposedStartsAt: "2026-10-03T02:00:00+00:00", canConfirm: true });
    state.results.parent_assessment_overview = ok(overview([proposed]));
    expect((await (await GET(getRequest())).json()).requests[0]).toMatchObject({ scheduledAt: null, proposedStartsAt: proposed.proposedStartsAt, canConfirm: true });
    const confirmed = await POST(postRequest(confirmCommand()));
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ state: "confirmed", scheduledAt: "2026-10-03T02:00:00+00:00", proposedStartsAt: null, canConfirm: false });
    expect(state.rpc).toHaveBeenCalledWith("confirm_parent_assessment", {
      p_invitation_id: invitation, p_student_id: child, p_time_option: option, p_expected_updated_at: updatedAt,
    });
  });

  it("同一已确认时段重试由数据库决定，HTTP 保留过去日期与原始版本", async () => {
    state.results.confirm_parent_assessment = ok(requestRow({ state: "confirmed", scheduledAt: "2020-01-01T02:00:00Z" }));
    const response = await POST(postRequest({ ...confirmCommand(), timeOption: "2020-01-01@10:00" }));
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("confirm_parent_assessment", expect.objectContaining({ p_time_option: "2020-01-01@10:00", p_expected_updated_at: updatedAt }));
  });

  it.each([
    "NO_LINKED_LEAD", "AMBIGUOUS_LINKED_LEAD", "LEAD_UNAVAILABLE", "ACTIVE_INVITATION",
    "NO_ELIGIBLE_TEACHER", "IDEMPOTENCY_CONFLICT", "TIME_UNAVAILABLE", "CONFLICT",
  ])("把业务冲突 %s 统一为可恢复的 CONFLICT", async (message) => {
    state.results.request_parent_assessment = fail(message);
    const response = await POST(postRequest(requestCommand()));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "CONFLICT" });
  });

  it.each([
    ["VALIDATION", undefined, 400, "VALIDATION"],
    ["FORBIDDEN", undefined, 403, "FORBIDDEN"],
    ["NOT_FOUND", undefined, 404, "NOT_FOUND"],
    ["permission denied", "42501", 403, "FORBIDDEN"],
    ["database unavailable", undefined, 503, "UNAVAILABLE"],
  ])("保留确认错误 %s 的安全语义", async (message, code, status, expected) => {
    state.results.confirm_parent_assessment = fail(message as string, code as string | undefined);
    const response = await POST(postRequest(confirmCommand()));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code: expected });
  });

  it("拒绝客户端改状态、老师意向、畸形日期、重复和过量选项", async () => {
    const tooMany = Array.from({ length: 85 }, (_, index) => `${new Date(Date.UTC(2026, 9, index + 1)).toISOString().slice(0, 10)}@10:00`);
    for (const body of [
      { ...requestCommand(), id: "unstable-id" },
      { ...requestCommand(), state: "confirmed" },
      { ...requestCommand(), teacherTimeOptions: [option] },
      { ...requestCommand(), parentTimeOptions: [] },
      { ...requestCommand(), parentTimeOptions: [option, option] },
      { ...requestCommand(), parentTimeOptions: tooMany },
      { ...requestCommand(), parentTimeOptions: ["2026-02-30@10:00"] },
      { ...requestCommand(), parentTimeOptions: ["2026-10-03@11:00"] },
      { ...requestCommand(), parentTimeOptions: ["0000-01-01@10:00"] },
      { ...confirmCommand(), timeOption: "2026-10-03@after_school" },
      { ...confirmCommand(), expectedUpdatedAt: "2026-10-01T12:00:00" },
      { action: "cancel", id: invitation, participantId: child },
    ]) expect((await POST(postRequest(body))).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("继承 JSON 类型和 32 KiB 上限", async () => {
    const tooLarge = await POST(postRequest({ ...requestCommand(), extra: "x".repeat(33 * 1024) }));
    expect(tooLarge.status).toBe(413);
    const plainText = await POST(new Request("https://app.example.invalid/api/v1/parent/assessments", {
      method: "POST", headers: { "content-type": "text/plain" }, body: "{}",
    }));
    expect(plainText.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("RPC 响应缺字段、状态时间矛盾或伪造共有时段时返回不可用", async () => {
    for (const record of [
      null, { id: invitation }, requestRow({ state: "awaiting_teacher", scheduledAt: "2026-10-03T02:00:00Z" }),
      requestRow({ state: "confirmed", proposedStartsAt: "2026-10-03T02:00:00Z" }),
      requestRow({ sharedTimeOptions: [option] }), requestRow({ canConfirm: true }),
      requestRow({ sharedTimeOptions: ["2026-10-03@after_school"] }),
    ]) {
      state.results.request_parent_assessment = ok(record);
      const response = await POST(postRequest(requestCommand()));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ code: "UNAVAILABLE" });
    }
    state.results.parent_assessment_overview = ok({ ...overview(), teachers: [] });
    // 新预约的教师通过单独的发布时段接口返回，旧任课教师列表允许为空。
    expect((await GET(getRequest())).status).toBe(200);
    state.results.parent_assessment_overview = ok({ ...overview(), eligibility: { canRequest: false, reason: null } });
    expect((await GET(getRequest())).status).toBe(503);
    state.results.confirm_parent_assessment = ok(requestRow());
    expect((await POST(postRequest(confirmCommand()))).status).toBe(503);
    state.results.confirm_parent_assessment = ok(requestRow({ state: "confirmed", scheduledAt: null }));
    expect((await POST(postRequest(confirmCommand()))).status).toBe(503);
  });
});

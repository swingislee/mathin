import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TeachingRecords } from "@/features/school/teaching-workbench/teaching-records-contract";

const deps = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireAnyPerm: deps.authorize }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: deps.rpc }) }));
vi.mock("@/features/school/session-communication-read", () => ({ getSessionCommunications: vi.fn() }));
import { getClassSessionObservations } from "@/features/school/class-roster-session-read";
import { POST } from "@/app/[locale]/dashboard/classes/session-observations/route";

const id = "12345678-1234-4234-9234-123456789abc";
const classroomId = "12345678-1234-4234-9234-123456789def";
const records = (sessionId: string): TeachingRecords => ({
  session: { id: sessionId, classroomId, classroomName: "Class", title: "Lesson", scheduledAt: null, startedAt: null, endedAt: null },
  students: [{ id: "frozen", name: "Frozen student" }, { id: "temporary", name: "Temporary student" }],
  attendance: [], checks: [{ id: "first", title: "Question one" }, { id: "unrecorded", title: "Question two" }],
  results: [{ checkId: "first", studentId: "frozen", status: "explained", markedAt: "2026-09-20T01:00:00Z", author: null },
    { checkId: "first", studentId: "temporary", status: "prompted", markedAt: "2026-09-20T01:00:00Z", author: null }],
  reviews: [], canReadContacts: false, contacts: [], contactTotal: 0, contactPage: 1, supportNotes: [],
});
const request = (input: unknown) => new Request("http://example.test/zh/dashboard/classes/session-observations", { method: "POST", body: JSON.stringify(input) });
const context = { params: Promise.resolve({ locale: "zh" }) };

beforeEach(() => {
  vi.resetAllMocks();
  deps.authorize.mockResolvedValue({ id: "user" });
  deps.rpc.mockImplementation(async (_name: string, input: { p_session_id: string }) => ({ data: records(input.p_session_id), error: null }));
});

describe("班级课次答题摘要", () => {
  it("复用原课次授权与实际名单记录，输出五种次数和记录覆盖", async () => {
    const response = await POST(request({ classroomId, sessionIds: [id, id] }), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(deps.authorize).toHaveBeenCalledWith("zh", ["class.view.mine", "class.view.all"]);
    expect(deps.rpc).toHaveBeenCalledExactlyOnceWith("get_teaching_session_records", { p_session_id: id, p_contact_page: 1 });
    expect(await response.json()).toEqual([{ sessionId: id, observations: {
      explained: 1, independent: 0, prompted: 1, imitated: 0, incomplete: 0, recordedChecks: 1, totalChecks: 2,
      focusChecks: [{ title: "Question one", recorded: 2, supported: 1 }],
    } }]);
  });

  it("班级不匹配、RPC 拒绝或畸形记录标为未知，真实空记录才显示零", async () => {
    deps.rpc.mockImplementation(async (_name: string, input: { p_session_id: string }) => {
      if (input.p_session_id === "denied") return { data: null, error: { message: "private database reason" } };
      if (input.p_session_id === "malformed") return { data: {}, error: null };
      const data = records(input.p_session_id);
      if (input.p_session_id === "other") data.session.classroomId = "other-class";
      if (input.p_session_id === "empty") { data.checks = []; data.results = []; }
      return { data, error: null };
    });
    const result = await getClassSessionObservations(classroomId, ["denied", "malformed", "other", "empty"]);
    expect(result.slice(0, 3).map(row => row.observations)).toEqual([null, null, null]);
    expect(result[3].observations).toMatchObject({ explained: 0, independent: 0, prompted: 0, imitated: 0, incomplete: 0, recordedChecks: 0, totalChecks: 0 });
  });

  it("校验批量输入，身份失败时不读取", async () => {
    for (const input of [{ classroomId: "invalid", sessionIds: [id] }, { classroomId, sessionIds: [] },
      { classroomId, sessionIds: ["invalid"] }, { classroomId, sessionIds: Array.from({ length: 41 }, () => id) }]) {
      expect((await POST(request(input), context)).status).toBe(400);
    }
    expect(deps.rpc).not.toHaveBeenCalled();
    deps.authorize.mockRejectedValueOnce(new Error("identity redirect"));
    await expect(POST(request({ classroomId, sessionIds: [id] }), context)).rejects.toThrow("identity redirect");
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it("限制展开后的课次读取并发，保留每课对应关系", async () => {
    let active = 0, maximum = 0;
    deps.rpc.mockImplementation(async (_name: string, input: { p_session_id: string }) => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 0));
      active--;
      return { data: records(input.p_session_id), error: null };
    });
    const ids = Array.from({ length: 9 }, (_, index) => `lesson-${index}`);
    expect((await getClassSessionObservations(classroomId, ids)).map(row => row.sessionId)).toEqual(ids);
    expect(maximum).toBe(4);
  });
});

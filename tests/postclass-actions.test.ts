import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishSessionAssignmentAction } from "@/features/school/actions/classes";
import { addStudentFollowUps } from "@/features/school/actions/followups";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), insert: vi.fn(), authorize: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/features/courseware-studio/data", () => ({ materializeSessionResolved: vi.fn() }));
vi.mock("@/features/school/courses", () => ({ getSessionCoursewareTemplate: vi.fn() }));
vi.mock("@/features/school/actions/guards", () => ({ authorizedClient: mocks.authorize, nullableRpcArg: (value: unknown) => value }));
const first = "12345678-1234-4234-9234-123456789abc", second = "12345678-1234-4234-9234-123456789def";
beforeEach(() => {
  vi.clearAllMocks(); mocks.authorize.mockResolvedValue({ user: { id: first }, supabase: { rpc: mocks.rpc, from: () => ({ insert: mocks.insert }) } });
  mocks.rpc.mockResolvedValue({ error: null }); mocks.insert.mockResolvedValue({ error: null });
});
describe("课后写入口", () => {
  it("发布作业通过同一事务带入模板", async () => {
    expect(await publishSessionAssignmentAction({ sessionId: first, title: "本次作业", content: "说明", dueAt: null })).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("publish_session_template_assignment", { p_session_id: first, p_title: "本次作业", p_content: "说明", p_due_at: null });
  });
  it("保留管理者的原发布权限，旧发布仍拒绝越权", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: "FORBIDDEN" } }).mockResolvedValueOnce({ error: { message: "FORBIDDEN" } });
    expect(await publishSessionAssignmentAction({ sessionId: first, title: "本次作业", content: "", dueAt: null })).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(["publish_session_template_assignment", "publish_session_assignment"]);
  });
  it("批量跟进用一次数据库写入保存全部学生", async () => {
    expect(await addStudentFollowUps([{ studentId: first, content: "甲的记录" }, { studentId: second, content: "乙的记录" }])).toEqual({ ok: true });
    expect(mocks.authorize).toHaveBeenCalledWith("followup.write");
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ student_id: first, content: "甲的记录", author_id: first }),
      expect.objectContaining({ student_id: second, content: "乙的记录", author_id: first }),
    ]);
  });
  it("重复学生或空内容在写入前拒绝，数据库失败返回失败", async () => {
    expect(await addStudentFollowUps([{ studentId: first, content: "甲" }, { studentId: first, content: "乙" }])).toEqual({ ok: false, code: "VALIDATION" });
    expect(await addStudentFollowUps([{ studentId: first, content: "  " }])).toEqual({ ok: false, code: "VALIDATION" });
    expect(mocks.insert).not.toHaveBeenCalled();
    mocks.insert.mockResolvedValueOnce({ error: { message: "FORBIDDEN" } });
    expect(await addStudentFollowUps([{ studentId: first, content: "保留草稿" }])).toEqual({ ok: false, code: "FORBIDDEN" });
  });
});

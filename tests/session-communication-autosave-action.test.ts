import { beforeEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: deps.revalidate }));
vi.mock("@/features/school/actions/guards", () => ({ authorizedClient: deps.authorize, nullableRpcArg: (value: unknown) => value }));
import { saveSessionCommunication } from "@/features/school/session-communication-actions";
const input = { id: "12345678-1234-4234-9234-123456789abc", sessionId: "12345678-1234-4234-9234-123456789def", studentId: null,
  occurredOn: "2026-09-25", channel: "class_group" as const, outcome: "contacted" as const, content: "Class note", nextAction: "", nextFollowUpOn: null, expectedRevision: 0 };
beforeEach(() => { vi.resetAllMocks(); deps.authorize.mockResolvedValue({ supabase: { rpc: deps.rpc } }); });
describe("沟通自动保存服务端入口", () => {
  it("畸形版本及未填齐的跟进在调用数据库前被拒绝", async () => {
    expect(await saveSessionCommunication({ ...input, expectedRevision: -1 })).toEqual({ ok: false, code: "VALIDATION" });
    expect(await saveSessionCommunication({ ...input, outcome: "follow_up" })).toEqual({ ok: false, code: "VALIDATION" });
    expect(deps.authorize).not.toHaveBeenCalled();
  });
  it("传入版本锁并返回同一事务产生的完成状态", async () => {
    const data = { communications: { canRead: true, canWrite: true, completed: true, records: [] }, revision: 1 };
    deps.rpc.mockResolvedValue({ data, error: null });
    expect(await saveSessionCommunication(input)).toEqual({ ok: true, data });
    expect(deps.authorize).toHaveBeenCalledWith("followup.write");
    expect(deps.rpc).toHaveBeenCalledWith("save_session_communication", expect.objectContaining({ p_expected_revision: 0, p_student_id: null, p_session_id: input.sessionId }));
    expect(deps.revalidate).toHaveBeenCalled();
  });
});

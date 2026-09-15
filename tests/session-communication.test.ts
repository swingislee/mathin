import { describe, expect, it } from "vitest";
import { classroomWorkSessionHref, classroomWorkSessions, type ClassroomWorkSession } from "../src/features/school/classroom-workbench-contract";
import { latestSessionCommunication, removeCommunicationDraft, sessionCommunicationProgress, type SessionCommunication, type CommunicationDraft } from "../src/features/school/session-communication-contract";

const record = (id: string, studentId: string | null, outcome: SessionCommunication["outcome"], createdAt = "2026-09-15T10:00:00Z"): SessionCommunication => ({
  id, studentId, outcome, createdAt, content: id, occurredOn: "2026-09-15", channel: "wechat", nextAction: "", nextFollowUpOn: null, author: "Teacher",
});

describe("课次沟通工作状态", () => {
  it("保存一人后保留剩余学生，班级消息不冒充逐生完成", () => {
    const progress = sessionCommunicationProgress(["a", "b"], [record("1", "a", "contacted"), record("2", null, "contacted")]);
    expect(progress).toMatchObject({ contacted: 1, pending: 1, canComplete: false });
  });
  it("逐生决定与班级待跟进分别影响完成，明确无需沟通可完成", () => {
    const records = [record("1", "a", "contacted"), record("2", "b", "not_needed")];
    expect(sessionCommunicationProgress(["a", "b"], records).canComplete).toBe(true);
    expect(sessionCommunicationProgress(["a", "b"], [...records, record("3", null, "follow_up")]).canComplete).toBe(false);
    expect(sessionCommunicationProgress(["a", "b"], [...records, record("3", "b", "follow_up", "2026-09-16T00:00:00Z")])).toMatchObject({ follow_up: 1, not_needed: 0, canComplete: false });
  });
  it("补记历史日期以本次录入决定当前状态，传入顺序不影响结果", () => {
    const earlier = record("1", "a", "follow_up");
    const later = { ...record("2", "a", "contacted", "2026-09-16T10:00:00Z"), occurredOn: "2026-09-10" };
    expect(latestSessionCommunication([later, earlier], "a")).toEqual(later);
  });
  it("保存当前人保留另一人草稿及原始状态对象", () => {
    const draft: CommunicationDraft = { id: "draft", occurredOn: "2026-09-15", channel: "phone", outcome: "contacted", content: "Unsaved", nextAction: "", nextFollowUpOn: "" };
    const original = { a: draft, b: { ...draft, id: "second", content: "Still editing" } };
    expect(removeCommunicationDraft(original, "a")).toEqual({ b: original.b });
    expect(original.a).toBe(draft);
  });
});

describe("班级课次入口", () => {
  const session = (id: string, overrides: Partial<ClassroomWorkSession> = {}): ClassroomWorkSession => ({ id, classroomId: "a", title: id, scheduledAt: "2026-09-15T10:00:00Z", startedAt: null, endedAt: null, ...overrides });
  it("备课、课堂进行中、课后记录由实际状态选择，不把已过日期当成已下课", () => {
    expect(classroomWorkSessionHref(session("scheduled"))).toBe("/dashboard/sessions/scheduled?stage=pre");
    expect(classroomWorkSessionHref(session("live", { startedAt: "2026-09-15T10:00:00Z" }))).toBe("/dashboard/sessions/live?stage=live");
    expect(classroomWorkSessionHref(session("ended", { endedAt: "2026-09-15T11:00:00Z" }))).toBe("/dashboard/sessions/ended?stage=post");
  });
  it("每班只列自己的课次，课后记录按最近课次优先", () => {
    const records = [session("old", { scheduledAt: "2026-09-01T10:00:00Z", endedAt: "2026-09-01T11:00:00Z" }), session("recent", { endedAt: "2026-09-15T11:00:00Z" }), session("future"), session("other", { classroomId: "b" })];
    expect(classroomWorkSessions(records, "a", "ended").map(row => row.id)).toEqual(["recent", "old"]);
    expect(classroomWorkSessions(records, "a", "upcoming").map(row => row.id)).toEqual(["future"]);
  });
});

// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionCommunicationAutosave } from "@/features/school/use-session-communication-autosave";
import type { SessionCommunications } from "@/features/school/session-communication-contract";
const save = vi.hoisted(() => vi.fn());
vi.mock("@/features/school/session-communication-actions", () => ({ saveSessionCommunication: save }));
const initial: SessionCommunications = { canRead: true, canWrite: true, completed: false, records: [] };
type Controller = ReturnType<typeof useSessionCommunicationAutosave>;
let controller: Controller, root: Root, container: HTMLDivElement;
function Harness({ readonly = false }: { readonly?: boolean }) {
  const value = useSessionCommunicationAutosave("lesson", { ...initial, canWrite: !readonly }, "zh", "2026-09-25");
  useEffect(() => { controller = value; });
  return null;
}
type Input = { id: string; studentId: string | null; content: string; expectedRevision: number; outcome: "contacted" | "follow_up" | "not_needed" };
const success = (input: Input) => ({ ok: true, data: { revision: input.expectedRevision + 1, communications: { ...initial, records: [{
  id: input.id, studentId: input.studentId, content: input.content, outcome: input.outcome, occurredOn: "2026-09-25", channel: "wechat",
  nextAction: "", nextFollowUpOn: null, author: "Teacher", createdAt: "2026-09-25T00:00:00Z",
}] } } });
const edit = async (key: string, patch: Parameters<Controller["change"]>[1]) => { await act(async () => { controller.open(key); controller.change(key, patch); }); };
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(1100); }); };
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => { for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256); return bytes; } });
  save.mockImplementation(async input => success(input));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("课次沟通自动保存", () => {
  it("停顿后保存，继续输入使用同一记录及服务端版本，不清空编辑器", async () => {
    await edit("student", { content: "Initial" }); expect(save).not.toHaveBeenCalled(); expect(controller.dirty).toBe(true);
    await tick(); expect(controller.dirty).toBe(false);
    const id = controller.entries.student.draft.id;
    await edit("student", { content: "Complete note" }); await tick();
    expect(save.mock.calls.map(call => [call[0].id, call[0].expectedRevision])).toEqual([[id, 0], [id, 1]]);
    expect(controller.entries.student.draft.content).toBe("Complete note");
    expect(controller.communications.records).toHaveLength(1);
    await act(async () => { controller.addAnother("student"); });
    expect(controller.entries.student.draft.id).not.toBe(id); expect(controller.entries.student.draft.content).toBe("");
  });
  it("请求期间可以继续输入，旧响应不清除新内容，后续请求串行发送最新版本", async () => {
    let resolve!: (value: unknown) => void;
    save.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await edit("student", { content: "First" }); await tick();
    await edit("student", { content: "Second" }); await edit("student", { content: "Newest" }); await tick();
    expect(save).toHaveBeenCalledTimes(1); expect(controller.dirty).toBe(true);
    await act(async () => resolve(success(save.mock.calls[0][0])));
    expect(save).toHaveBeenCalledTimes(2); expect(save.mock.calls[1][0]).toMatchObject({ content: "Newest", expectedRevision: 1 });
    expect(controller.dirty).toBe(false); expect(controller.entries.student.saved?.content).toBe("Newest");
  });
  it("响应丢失后先重试同一请求，再保存新输入，不另建记录", async () => {
    save.mockRejectedValueOnce(new Error("response lost"));
    await edit("student", { content: "Accepted but response lost" }); await tick();
    expect(controller.entries.student.state).toBe("error"); expect(controller.dirty).toBe(true);
    const first = save.mock.calls[0][0];
    await edit("student", { content: "Continued editing" }); await tick();
    expect(save.mock.calls[1][0]).toEqual(first);
    expect(save.mock.calls[2][0]).toMatchObject({ id: first.id, content: "Continued editing", expectedRevision: 1 });
    expect(controller.dirty).toBe(false);
  });
  it("待跟进要填齐事项和日期；明确无需沟通可自动保存，空白打开不生成记录", async () => {
    await act(async () => controller.open("empty")); await tick(); expect(save).not.toHaveBeenCalled();
    await edit("student", { content: "Discussed", outcome: "follow_up" }); await tick();
    expect(save).not.toHaveBeenCalled(); expect(controller.entries.student.state).toBe("invalid");
    await edit("student", { nextAction: "Call", nextFollowUpOn: "2026-09-26" }); await tick();
    expect(save).toHaveBeenCalledTimes(1);
    await edit("other", { outcome: "not_needed" }); await tick();
    expect(save.mock.calls[1][0]).toMatchObject({ studentId: "other", content: "本次课无需单独沟通。", outcome: "not_needed" });
  });
  it("离开字段会立即同步，各行失败独立保留，恢复联网后重试", async () => {
    save.mockResolvedValueOnce({ ok: false, code: "ERROR" });
    await edit("student", { content: "First" });
    await act(async () => { await controller.flush("student"); });
    await edit("other", { content: "Other" }); await tick();
    expect(controller.entries.student.state).toBe("error"); expect(controller.entries.other.state).toBe("saved");
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(controller.dirty).toBe(false); expect(save.mock.calls.map(call => call[0].studentId)).toEqual(["student", "other", "student"]);
  });
  it("版本冲突保留内容，不自动覆盖，可以放弃未保存更改", async () => {
    save.mockResolvedValueOnce({ ok: false, code: "SUBMISSION_CONFLICT" });
    await edit("student", { content: "Keep me" }); await tick();
    expect(controller.entries.student.error).toContain("重新读取"); expect(controller.entries.student.draft.content).toBe("Keep me");
    await tick(); expect(save).toHaveBeenCalledTimes(1);
    await act(async () => controller.discard("student")); expect(controller.dirty).toBe(false);
  });
  it("卸载补发定时器内的内容，只读角色不会开始写入", async () => {
    await edit("student", { content: "Last edit" });
    await act(async () => root.render(createElement(Harness, { key: "readonly", readonly: true })));
    expect(save).toHaveBeenCalledTimes(1);
    await edit("other", { content: "Not allowed" }); await tick();
    expect(save).toHaveBeenCalledTimes(1); expect(controller.entries).toEqual({});
  });
});

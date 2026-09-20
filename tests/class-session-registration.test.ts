// @vitest-environment jsdom
import { act, createElement as h, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../messages/zh.json";
import { ClassRosterSessionDetail } from "@/features/school/ClassRosterSessionDetail";
import { ClassRosterSessionRow } from "@/features/school/ClassRosterSessionRow";
import type { ClassRosterSession, ClassSessionDetail } from "@/features/school/class-roster-session-contract";

const deps = vi.hoisted(() => ({ save: vi.fn(), record: vi.fn(), refresh: vi.fn(), fetch: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/school/review-actions", () => ({ saveSessionReviewsAction: deps.save }));
vi.mock("@/features/school/session-communication-actions", () => ({ recordSessionCommunication: deps.record, finishSessionCommunications: vi.fn() }));
vi.mock("@/features/school/learning-result-actions", () => ({ publishSessionReviewsAction: vi.fn() }));
vi.mock("@/features/school/LearningResultWithdrawButton", () => ({ LearningResultWithdrawButton: () => null }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: deps.refresh }), Link: ({ children }: { children: ReactNode }) => h("span", {}, children) }));
// 这里覆盖行下登记；原教学汇总、作业和联系分页由各自合同覆盖。
vi.mock("@/features/school/teaching-workbench/TeachingSessionRecords", () => ({ TeachingSessionRecords: ({ studentWork }: { studentWork: ReactNode }) => studentWork }));
vi.mock("next/dynamic", () => ({ default: () => ClassRosterSessionDetail }));
const first = "12345678-1234-4234-9234-123456789abc", second = "12345678-1234-4234-9234-123456789def";
const communications = { canRead: true, canWrite: true, completed: false, records: [] };
function detail(sessionId: string): ClassSessionDetail {
  return { canWriteReview: true, resultStatus: "draft", records: {
    session: { id: sessionId, classroomId: "class", classroomName: "Class", title: sessionId, scheduledAt: "2026-09-20T02:00:00Z", startedAt: null, endedAt: null },
    students: [{ id: first, name: "本课学生甲" }, { id: second, name: "临时学生乙" }],
    attendance: [], checks: [], results: [], reviews: [], canReadContacts: true, contacts: [], contactPage: 1, contactTotal: 0, supportNotes: [], sessionCommunications: communications,
  } };
}
const sessions: ClassRosterSession[] = ["previous", "today"].map((id, index) => ({ id, classroomId: "class", title: id,
  scheduledAt: index ? "2026-09-20T02:00:00Z" : "2026-09-13T02:00:00Z", startedAt: null, endedAt: null, attendanceCount: index, reviewCount: index }));
function Harness() {
  const [expanded, setExpanded] = useState(false), [dirty, setDirty] = useState(false);
  return h(NextIntlClientProvider, { locale: "zh", messages, timeZone: "Asia/Shanghai", children: h("table", {}, h("tbody", {},
    h(ClassRosterSessionRow, { classroomId: "class", sessions, locale: "zh", timeZone: "Asia/Shanghai", now: Date.parse("2026-09-20T01:00:00Z"),
      expanded, canChange: () => !dirty, onExpandedChange: setExpanded, onDirtyChange: setDirty }))) });
}
let root: Root, container: HTMLDivElement;
const click = async (element: HTMLElement) => { expect(element).toBeTruthy(); await act(async () => element.click()); };
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.includes(label))!;
async function fill(input: HTMLInputElement | HTMLTextAreaElement, text: string) {
  expect(input).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true })); });
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => { for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256); return bytes; } });
  vi.stubGlobal("fetch", deps.fetch);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
  deps.fetch.mockImplementation(async (_url: string, options: RequestInit) => ({ ok: true, json: async () => detail(JSON.parse(String(options.body)).sessionId) }));
  deps.save.mockResolvedValue({ ok: true });
  deps.record.mockImplementation(async (input: { id: string; sessionId: string; studentId: string; content: string }) => ({ ok: true, data: { ...communications,
    records: [{ id: input.id, studentId: input.studentId, content: input.content, occurredOn: "2026-09-20", channel: "wechat", outcome: "contacted", nextAction: "", nextFollowUpOn: null, author: "Teacher", createdAt: "2026-09-20T01:00:00Z" }] } }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(h(Harness)));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("班级下直接连续登记", () => {
  it("首次只显示课次条；展开本课、保存并下一位，草稿阻止切课且失败保留", async () => {
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(container.textContent).toContain("考勤 1 · 课评 1");
    await click(button("查看 / 登记"));
    expect(deps.fetch.mock.calls[0][0]).toContain("/classes/session-detail");
    expect(container.querySelector('[data-session-id="today"]')).not.toBeNull();
    await click(container.querySelector<HTMLElement>(`[data-followup-row-key="${first}"]`)!);
    await fill(container.querySelector("textarea")!, "已沟通的内容");
    await click(container.querySelector<HTMLButtonElement>('[aria-label="上一课"]')!);
    expect(container.querySelector('[data-session-id="today"]')).not.toBeNull();
    deps.record.mockResolvedValueOnce({ ok: false, code: "ERROR" });
    await click(button("保存并下一位"));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("已沟通的内容");
    await click(button("保存并下一位"));
    expect(deps.record).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "today", studentId: first, content: "已沟通的内容" }));
    expect(container.querySelector(`[data-followup-row-key="${second}"]`)?.getAttribute("aria-expanded")).toBe("true");
    await click(container.querySelector<HTMLButtonElement>('[aria-label="上一课"]')!);
    expect(container.querySelector('[data-session-id="previous"]')).not.toBeNull();
  });
  it("课评只保存编辑过的学生，自动保存完成后才能切换", async () => {
    await click(button("查看 / 登记"));
    await click(container.querySelector<HTMLElement>(`[data-followup-row-key="${second}"]`)!);
    vi.useFakeTimers();
    await fill(container.querySelector<HTMLInputElement>(`input[id="review-today-${second}"]`)!, "临时学生的点评");
    await click(container.querySelector<HTMLButtonElement>('[aria-label="上一课"]')!);
    expect(container.querySelector('[data-session-id="today"]')).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(deps.save).toHaveBeenCalledExactlyOnceWith("today", [expect.objectContaining({ studentId: second, comment: "临时学生的点评" })]);
    await click(container.querySelector<HTMLButtonElement>('[aria-label="上一课"]')!);
    expect(container.querySelector('[data-session-id="previous"]')).not.toBeNull();
  });
});

// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ComponentType, type PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../messages/zh.json";
import { AssignmentQuestionWorkbench } from "@/features/school/AssignmentQuestionWorkbench";
import { assignmentQuestionUndo, mergeAssignmentQuestionResults, type AssignmentQuestionWorkbook } from "@/features/school/assignment-question-contract";
import { saveAssignmentQuestionResultsAction } from "@/features/school/assignment-question-actions";

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/school/assignment-question-actions", () => ({ addAssignmentQuestionsAction: vi.fn(), saveAssignmentQuestionResultsAction: vi.fn() }));
const student = "00000000-0000-4000-8000-000000000001";
const question = "00000000-0000-4000-8000-000000000002";
const second = "00000000-0000-4000-8000-000000000003";
const data: AssignmentQuestionWorkbook = {
  assignment: { id: "00000000-0000-4000-8000-000000000004", title: "纸质作业", classroomName: "示例班", sessionId: null },
  canWrite: true, students: [{ id: student, name: "学生甲" }], questions: [{ id: question, title: "第一题", position: 0 }, { id: second, title: "第二题", position: 1 }], results: [],
};
const Provider = NextIntlClientProvider as ComponentType<PropsWithChildren<Omit<ComponentProps<typeof NextIntlClientProvider>, "children">>>;
afterEach(() => { vi.clearAllMocks(); });

describe("paper homework question entry", () => {
  it("keeps saved versions and reconstructs an undo without deleting records", () => {
    const saved = { questionId: question, studentId: student, status: "independent" as const, note: "说明", version: 1, markedAt: "2026-09-15T00:00:00Z", author: "教师" };
    expect(assignmentQuestionUndo([], [saved])).toEqual([{ questionId: question, studentId: student, status: "unchecked", note: "", expectedVersion: 1 }]);
    const revised = { ...saved, status: "prompted" as const, version: 2 };
    expect(mergeAssignmentQuestionResults([saved], [revised])).toEqual([revised]);
    expect(assignmentQuestionUndo([saved], [revised])[0]).toMatchObject({ expectedVersion: 2, status: "independent", note: "说明" });
  });

  it("registers paper homework without any online submission and updates the overview after save", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.mocked(saveAssignmentQuestionResultsAction).mockImplementation(async input => ({ ok: true, data: input.changes.map(change => ({
      ...change, version: change.expectedVersion + 1, markedAt: "2026-09-15T00:00:00Z", author: "老师甲",
    })) }));
    const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(Provider, { locale: "zh", messages, timeZone: "Asia/Shanghai" }, createElement(AssignmentQuestionWorkbench, { initial: data }))));
      const choice = [...container.querySelectorAll('button[aria-label="独立完成"]')][0] as HTMLButtonElement;
      expect(choice).toBeTruthy();
      await act(async () => choice.click());
      expect(saveAssignmentQuestionResultsAction).toHaveBeenCalledWith({ assignmentId: data.assignment.id, changes: [{ studentId: student, questionId: question, status: "independent", note: "", expectedVersion: 0 }] });
      expect(container.querySelector('tbody [data-learning-status="independent"]')).toBeTruthy();
      expect(container.querySelector('tbody')?.textContent).toContain("1/2");
      expect(container.textContent).toContain("已保存");
      const undo = container.querySelector('[data-learning-fill-rail] button[aria-label="撤销上次登记"]') as HTMLButtonElement;
      expect(undo).toBeTruthy();
      await act(async () => undo.click());
      expect(vi.mocked(saveAssignmentQuestionResultsAction).mock.calls.at(-1)?.[0].changes[0]).toMatchObject({ status: "unchecked", expectedVersion: 1 });
      expect(container.querySelector('tbody')?.textContent).toContain("0/2");
    } finally { await act(async () => root.unmount()); container.remove(); }
  });

  it("does not present a conflicting write as saved or change its summary", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.mocked(saveAssignmentQuestionResultsAction).mockResolvedValue({ ok: false, code: "CONFLICT" });
    const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(Provider, { locale: "zh", messages, timeZone: "Asia/Shanghai" }, createElement(AssignmentQuestionWorkbench, { initial: data }))));
      await act(async () => (container.querySelector('button[aria-label="独立完成"]') as HTMLButtonElement).click());
      expect(container.textContent).toContain("记录已被其他操作更新");
      expect(container.querySelector('tbody')?.textContent).toContain("0/2");
      expect(container.querySelector('tbody [data-learning-status="independent"]')).toBeNull();
    } finally { await act(async () => root.unmount()); container.remove(); }
  });

  it("gives read-only managers the same compact overview without entry controls", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(Provider, { locale: "zh", messages, timeZone: "Asia/Shanghai" }, createElement(AssignmentQuestionWorkbench, { initial: { ...data, canWrite: false } }))));
      expect(container.querySelector('tbody [data-learning-status="unchecked"]')).toBeTruthy();
      expect(container.querySelector('button[aria-label="独立完成"]')).toBeNull();
      expect(container.querySelector('textarea')).toBeNull();
      expect(saveAssignmentQuestionResultsAction).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});

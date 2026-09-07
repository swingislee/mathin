// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import { StudentStageWorkspace } from "@/features/school/StudentStageWorkspace";
import { STUDENT_STAGE_TABS, type StudentStage, type StudentStageRow } from "@/features/school/student-stage-contract";

const actions = vi.hoisted(() => ({ save: vi.fn(), options: vi.fn(), assign: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/school/student-stage-actions", () => ({ saveStudentStageEntryAction: actions.save, getStudentStageOptionsAction: actions.options, assignStudentStageAction: actions.assign }));
vi.mock("next/dynamic", async () => { const entry = await import("@/features/school/StudentStageEntry"); return { default: () => entry.StudentStageEntry }; });
vi.mock("@/features/school/Student360Sheet", () => ({ Student360Trigger: ({ children }: { children: ReactNode }) => createElement("button", { type: "button" }, children) }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: ComponentProps<"a">) => createElement("a", props, children),
  useRouter: () => ({ replace: vi.fn(), refresh: actions.refresh }), usePathname: () => "/dashboard/students" }));

const id = "00000000-0000-4000-8000-000000000012";
const row: StudentStageRow = { key: `lead:${id}`, studentId: null, leadId: id, name: "示例学生", phone: "", grade: 3, gradeText: "",
  ownerId: "owner", ownerName: "原负责人", stage: "awaiting_first_contact", detail: "not_contacted", note: "", lastContactAt: null, nextContactAt: null,
  score: null, assessmentBand: null, assessmentAt: null, registrationId: null, courseTitle: "", termName: "", courseId: null, termId: null,
  createdAt: "2026-09-07T12:00:00Z", canWrite: true, canContact: true, invitation: null };
let root: Root, container: HTMLDivElement;
async function render(stage: StudentStage = "awaiting_first_contact") {
  const props: ComponentProps<typeof StudentStageWorkspace> = {
    data: { rows: [{ ...row, stage }], counts: { [stage]: 1 }, page: 1, pageSize: 50, totalPages: 1, count: 1 },
    filters: { stage, scope: "all", detail: "", q: "", page: 1, pageSize: 50 }, locale: "zh", currentUserId: "owner", canEnroll: false,
    canAssign: true, assignees: [{ userId: "next-owner", displayName: "新负责人" }], actions: null, timeZone: "Asia/Shanghai",
  };
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "zh", messages: zh, timeZone: "Asia/Shanghai" }, createElement(StudentStageWorkspace, props))));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollIntoView = vi.fn(); sessionStorage.clear(); vi.clearAllMocks();
  actions.options.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
  actions.save.mockResolvedValue({ ok: true, data: { subject: { ...row, studentId: id, key: `student:${id}`, stage: "awaiting_assessment", detail: "not_booked" }, savedAt: row.createdAt, opportunityId: null, enrollmentId: null } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("student stage workspace wiring", () => {
  it.each(STUDENT_STAGE_TABS)("offers row assignment and the same batch control in %s", async stage => {
    await render(stage);
    expect(container.querySelector('[aria-label="分配 · 示例学生"]')).not.toBeNull();
    const checkbox = container.querySelector<HTMLButtonElement>('[aria-label="勾选本页"]')!;
    await act(async () => checkbox.click());
    expect(container.querySelectorAll('[data-student-stage-assignment]')).toHaveLength(1);
    expect(container.querySelector('[aria-label="勾选学生 · 示例学生"]')?.getAttribute("aria-checked")).toBe("true");
    expect(actions.assign).not.toHaveBeenCalled();
  });
  it("opens the shared contact result from a row shortcut and saves its draft only with Ctrl+Enter", async () => {
    await render();
    const summary = container.querySelector<HTMLElement>("[data-student-stage-row]")!;
    await act(async () => { summary.dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true })); });
    const result = container.querySelector<HTMLElement>('[data-student-stage-entry] [aria-keyshortcuts="2"]')!;
    expect(result.getAttribute("aria-pressed")).toBe("true");
    expect(actions.save).not.toHaveBeenCalled();
    await act(async () => { summary.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })); });
    expect(actions.save).toHaveBeenCalledTimes(1);
    expect(actions.save.mock.calls[0][1]).toMatchObject({ leadId: id, mode: "contact", outcome: "connected" });
  });
});

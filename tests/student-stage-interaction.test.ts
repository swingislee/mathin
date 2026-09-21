// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import { StudentStageWorkspace } from "@/features/school/StudentStageWorkspace";
import { STUDENT_STAGE_TABS, type StudentStage, type StudentStageRow } from "@/features/school/student-stage-contract";
import { followupFieldPage } from "@/features/school/followup-table-page";
import { studentStageTableFields } from "@/features/school/student-stage-table-fields";
import { dashboardFieldMessages } from "@/features/school/dashboard-page/dashboard-field-messages";

const actions = vi.hoisted(() => ({ save: vi.fn(), options: vi.fn(), assign: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/school/student-stage-actions", () => ({ saveStudentStageEntryAction: actions.save, getStudentStageOptionsAction: actions.options, assignStudentStageAction: actions.assign }));
vi.mock("next/dynamic", async () => { const entry = await import("@/features/school/StudentStageEntry"); return { default: () => entry.StudentStageEntry }; });
vi.mock("@/features/school/Student360Sheet", () => ({ Student360Trigger: ({ children }: { children: ReactNode }) => createElement("button", { type: "button" }, children) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("stage=awaiting_first_contact&scope=all&page=3") }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: ComponentProps<"a">) => createElement("a", props, children),
  useRouter: () => ({ replace: actions.replace, refresh: actions.refresh }), usePathname: () => "/dashboard/students" }));

const id = "00000000-0000-4000-8000-000000000012";
const row: StudentStageRow = { key: `lead:${id}`, studentId: null, leadId: id, name: "示例学生", phone: "", grade: 3, gradeText: "",
  ownerId: "owner", ownerName: "原负责人", stage: "awaiting_first_contact", detail: "not_contacted", note: "", lastContactAt: null, nextContactAt: null,
  score: null, assessmentBand: null, assessmentAt: null, registrationId: null, courseTitle: "", termName: "", courseId: null, termId: null,
  createdAt: "2026-09-07T12:00:00Z", canWrite: true, canContact: true, invitation: null };
let root: Root, container: HTMLDivElement;
async function render(stage: StudentStage = "awaiting_first_contact", overrides: Partial<StudentStageRow> = {}, presentation: "students" | "communication" = "students", workspace: Partial<ComponentProps<typeof StudentStageWorkspace>> = {}) {
  const context = { locale: "zh", timeZone: "Asia/Shanghai", now: Date.parse(row.createdAt) };
  const fieldPage = followupFieldPage([{ ...row, stage, ...overrides }], studentStageTableFields("zh", stage, "owner"), undefined, context, 1, 50);
  const props: ComponentProps<typeof StudentStageWorkspace> = {
    presentation,
    data: { ...fieldPage, counts: { [stage]: 1 } },
    filters: { stage, scope: "all", detail: "", q: "", page: 1, pageSize: 50 }, locale: "zh", currentUserId: "owner", canEnroll: false,
    canAssign: true, assignees: [{ userId: "next-owner", displayName: "新负责人" }], actions: null, timeZone: "Asia/Shanghai", ...workspace,
  };
  const provider = { locale: "zh", messages: zh, timeZone: "Asia/Shanghai", children: createElement(StudentStageWorkspace, props) };
  await act(async () => root.render(createElement(NextIntlClientProvider, provider)));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn(); sessionStorage.clear(); vi.clearAllMocks();
  actions.options.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => ({ ok: true, json: async () => actions.options(JSON.parse(String(init.body))) })));
  actions.save.mockResolvedValue({ ok: true, data: { subject: { ...row, studentId: id, key: `student:${id}`, stage: "awaiting_assessment", detail: "not_booked" }, savedAt: row.createdAt, opportunityId: null, enrollmentId: null } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("student stage workspace wiring", () => {
  it("keeps a chosen mixed-stage list in order through save-and-next without reopening the full population", async () => {
    vi.stubGlobal("crypto", { randomUUID: undefined, getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    const first = { ...row, key: `student:${id}`, studentId: id, leadId: null };
    const second = { ...first, key: "student:00000000-0000-4000-8000-000000000013", studentId: "00000000-0000-4000-8000-000000000013", name: "下一位学生", stage: "awaiting_renewal" as const, detail: "enrolled" };
    const savedSubject = { ...first, stage: "awaiting_assessment", detail: "not_booked" };
    actions.save.mockResolvedValue({ ok: true, data: { subject: savedSubject, savedAt: row.createdAt, opportunityId: null, enrollmentId: null } });
    await render("awaiting_enrollment", {}, "communication", { canAssign: false, contactSelection: { requestedCount: 2 },
      data: { rows: [first, second], count: 2, page: 1, totalPages: 1, pageSize: 100, counts: {} } });
    expect(container.querySelector("h1")?.textContent).toBe("选定学生 · 2");
    expect(container.querySelector('[data-dashboard-search]')).toBeNull();
    expect(container.querySelector('a[href^="/dashboard/communication?stage="]')).toBeNull();
    const summary = container.querySelector<HTMLElement>("[data-student-stage-row]")!;
    await act(async () => summary.dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true })));
    const saveNext = [...container.querySelectorAll<HTMLButtonElement>("[data-student-stage-entry] button")].find(button => button.textContent?.includes("保存并下一位"))!;
    expect(saveNext).toBeTruthy();
    await act(async () => saveNext.click());
    expect(actions.save).toHaveBeenCalledTimes(1);
    const retained = [...container.querySelectorAll<HTMLElement>("[data-student-stage-row]")];
    expect(retained.map(element => element.dataset.studentStageRow)).toEqual([first.key, second.key]);
    expect(retained[0].dataset.studentStage).toBe("awaiting_assessment");
    expect(retained[1].getAttribute("aria-expanded")).toBe("true");
    expect(actions.replace).not.toHaveBeenCalled();
  });
  it("uses all five communication tabs and expands the stage-specific form without changing student classification", async () => {
    await render("awaiting_assessment", { studentId: id, detail: "not_booked" }, "communication");
    const stageLinks = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="/dashboard/communication?stage="]')];
    expect(stageLinks).toHaveLength(5);
    expect(container.querySelector("h1")?.textContent).toBe("沟通");
    expect(container.textContent).not.toMatch(/本轮工作|全部档案|具体办理日期/);
    expect(stageLinks.every(link => !link.href.includes("population=") && !link.href.includes("reason="))).toBe(true);
    const summary = container.querySelector<HTMLElement>("[data-student-stage-row]")!;
    await act(async () => { summary.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(container.querySelector('[role="tab"][data-state="active"]')?.textContent).toBe("测评／活动邀约");
    expect(actions.save).not.toHaveBeenCalled();
    expect(summary.dataset.studentStage).toBe("awaiting_assessment");
  });
  it("shows missing assessment fields alongside the completed assessment in awaiting enrollment", async () => {
    await render("awaiting_enrollment", { detail: "assessed", assessmentSource: "assessment", assessmentAt: "2026-09-02", teacherName: "老师" });
    const summary = container.querySelector<HTMLElement>("[data-student-stage-row]")!;
    expect(summary.dataset.studentStage).toBe("awaiting_enrollment");
    expect(summary.textContent).toContain("已有完成测评");
    const badge = summary.querySelector("[data-assessment-missing-details]");
    expect(badge?.textContent).toBe("资料待补");
    expect(badge?.getAttribute("title")).toContain("测评分数、测评等级");
  });
  it.each(STUDENT_STAGE_TABS)("offers row assignment and the same batch control in %s", async stage => {
    await render(stage);
    expect(container.querySelectorAll("thead [data-dashboard-table-menu]")).toHaveLength(stage === "awaiting_first_contact" || stage === "awaiting_assessment" ? 5 : 7);
    expect(container.querySelector("[data-dashboard-search]")).not.toBeNull();
    expect(container.querySelector("[data-followup-person]")).not.toBeNull();
    expect(container.querySelector('[aria-label="分配 · 示例学生"]')).not.toBeNull();
    const checkbox = container.querySelector<HTMLButtonElement>('[aria-label="勾选本页"]')!;
    await act(async () => checkbox.click());
    expect(container.querySelectorAll('[data-student-stage-assignment]')).toHaveLength(1);
    expect(container.querySelector('[aria-label="勾选学生 · 示例学生"]')?.getAttribute("aria-checked")).toBe("true");
    expect(actions.assign).not.toHaveBeenCalled();
  });
  it("shows the missed call and source learning support in separate columns", async () => {
    await render("awaiting_first_contact", { ownerId: null, ownerName: "原表学服", detail: "unreachable", canWrite: false });
    const summary = container.querySelector("[data-student-stage-row]")!;
    const cell = [...summary.querySelectorAll("td")].find(cell => cell.textContent?.includes("需再次联系"))!;
    expect(cell.textContent).not.toContain("原表学服");
    expect(cell.nextElementSibling?.textContent).toContain("原表学服");
    expect(summary.textContent).not.toContain("待分配");
    expect(Array.from(container.querySelectorAll("thead th"), cell => cell.textContent)).toEqual(expect.arrayContaining(["当前情况", "学服"]));
  });
  it("opens and saves an authorized unassigned record without requiring account linking", async () => {
    await render("awaiting_first_contact", { ownerId: null, ownerName: "原表学服", canWrite: true, canContact: true });
    const summary = container.querySelector<HTMLElement>("[data-student-stage-row]")!;
    await act(async () => { summary.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true })); });
    expect(container.querySelector("[data-student-stage-entry]")).not.toBeNull();
    expect(container.textContent).not.toContain("关联实际办理");
    await act(async () => { summary.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })); });
    expect(actions.save).toHaveBeenCalledTimes(1);
    expect(actions.save.mock.calls[0][1]).toMatchObject({ leadId: id, mode: "contact", outcome: "unreachable" });
    expect(actions.assign).not.toHaveBeenCalled();
  });
  it.each([
    { ownerId: "owner", ownerName: "原负责人", message: "登记需要相应的办理权限" },
    { ownerId: null, ownerName: "原表学服", message: "编辑需要相应的参与经历和岗位权限" },
  ])("explains the actual read-only restriction for $ownerName", async ({ message, ...owner }) => {
    await render("awaiting_assessment", { ...owner, canWrite: false, canContact: false });
    const summary = container.querySelector<HTMLElement>("[data-student-stage-row]")!;
    await act(async () => { summary.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(container.textContent).toContain(message);
    expect(container.textContent).not.toContain("关联实际办理");
    expect(container.textContent).not.toContain("再登记首联");
    expect(container.querySelector("[data-student-stage-entry]")).toBeNull();
    expect(actions.save).not.toHaveBeenCalled();
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
  it("uses the real field menu and server query hook for text, multiple selections and sorting", async () => {
    await render(); const m = dashboardFieldMessages("zh");
    await act(async () => container.querySelector<HTMLButtonElement>('thead [data-dashboard-table-menu]')!.click());
    const panel = document.querySelector('[data-table-field="name"]')!;
    const input = panel.querySelector<HTMLInputElement>('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "示例");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => document.querySelector<HTMLElement>('[data-field-option="3"]')!.click());
    await act(async () => [...panel.querySelectorAll<HTMLButtonElement>("button")].find(button => button.getAttribute("aria-label")?.endsWith(` · ${m.descending}`))!.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
    const url = new URL(actions.replace.mock.lastCall![0], "http://test.invalid");
    expect(url.searchParams.has("page")).toBe(false);
    expect(JSON.parse(url.searchParams.get("fields")!)).toEqual({ version: 2, filters: {
      name: { kind: "text", query: "示例" }, grade: { kind: "enum", values: ["3"] },
    }, sort: { field: "name", direction: "desc" } });
    expect(document.querySelectorAll("[data-dashboard-field-menu]")).toHaveLength(1);
    expect(container.querySelector("[data-student-stage-row]")).not.toBeNull();
    expect(actions.save).not.toHaveBeenCalled();
    expect(actions.assign).not.toHaveBeenCalled();
  });
});

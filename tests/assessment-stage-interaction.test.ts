// @vitest-environment jsdom
import { act, createElement, useState, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import { AssessmentRecordDetails } from "@/features/school/AssessmentRecordDetails";
import { ActivityAssessmentDraftProvider } from "@/features/school/ActivityAssessmentDetails";
import { assessmentWorkbenchStage, type AssessmentWorkbenchRow } from "@/features/school/assessment-workbench-contract";
import { assessmentWorkflowFromDb, type AssessmentWorkflowCommand } from "@/features/school/assessment-workflow-contract";

const actions = vi.hoisted(() => ({ save: vi.fn(), get: vi.fn(), history: vi.fn(), quick: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/school/assessment-workflow-actions", () => ({ saveAssessmentWorkflowAction: actions.save, getAssessmentWorkflowAction: actions.get, getAssessmentWorkflowHistoryAction: actions.history }));
vi.mock("@/features/school/assessment-quick-entry-actions", () => ({ saveAssessmentQuickEntryAction: actions.quick }));
vi.mock("@/features/school/activity-actions", () => ({ saveActivityAssessmentAction: vi.fn() }));
vi.mock("@/features/school/public-class-actions", () => ({ savePublicClassParticipantRecordAction: vi.fn() }));
vi.mock("@/features/school/EnrollmentHandoffButton", () => ({ PostActivityHandoff: () => createElement("div", null, "enrollment") }));
vi.mock("@/features/school/dashboard-page/FollowupChoice", () => ({ FollowupChoice: ({ label, disabled, value, onValueChange, options }: {
  label: string; disabled: boolean; value: string; onValueChange: (value: string) => void; options: { value: string; label: string }[];
}) => createElement("select", { "aria-label": label, disabled, value, onChange: (event: { currentTarget: HTMLSelectElement }) => onValueChange(event.currentTarget.value) },
  createElement("option", { value: "" }, ""), ...options.map((option) => createElement("option", { key: option.value, value: option.value }, option.label))) }));
vi.mock("@/components/ui/date-time-picker", () => ({ DateTimePicker: ({ id, value, disabled, onValueChange }: {
  id: string; value: string; disabled: boolean; onValueChange: (value: string) => void;
}) => createElement("input", { id, value, disabled, onChange: (event: { currentTarget: HTMLInputElement }) => onValueChange(event.currentTarget.value) }) }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: ComponentProps<"a">) => createElement("a", props, children) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const id = "00000000-0000-4000-8000-000000000002";
const time = "2026-09-07T03:00:00Z";
const workflow = assessmentWorkflowFromDb({ id, registration_id: id, stage: "pending", revision: 1, arrived_at: null,
  report_id: null, report: null, sent_report_id: null, sent_at: null, sent_by: null, classification: null,
  parent_response: "", reasons: [], next_contact_at: null, finalized_at: null, revision_reason: "", updated_by: id, updated_at: time });
const initial: AssessmentWorkbenchRow = { id, assessmentKind: "one_to_one", activityId: null, activityTitle: "测评", publicClassRecord: null,
  invitationId: id, registrationId: null, studentId: null, leadId: id, name: "同学", phone: "", grade: 3, gradeText: "",
  scheduledAt: time, location: "", assessorId: null, assessorName: "", assessorSource: "assigned", background: "",
  participationStatus: "booked", assessmentStartedAt: null, assessmentCompletedAt: null, assessment: null, questionSummary: null, route: null, updatedAt: time };

function Harness({ row: initialRow, canWrite }: { row: AssessmentWorkbenchRow; canWrite: boolean }) {
  const [row, setRow] = useState(initialRow);
  const children = createElement(AssessmentRecordDetails, { row, stage: assessmentWorkbenchStage(row), conclusion: "", locale: "zh",
    canAssess: canWrite, canQuickEntry: canWrite, canRoute: canWrite, canSupport: false, canManageAssessor: false,
    assessors: [], reassigning: false, onReassign: () => {}, onSaved: setRow, onHandoffSaved: () => {}, onNoteSaved: () => {} });
  const provider: ComponentProps<typeof ActivityAssessmentDraftProvider> = { row, children };
  return createElement(ActivityAssessmentDraftProvider, provider);
}

let root: Root; let container: HTMLDivElement;
const mount = async (row = initial, canWrite = true) => {
  const children: ReactNode = createElement(Harness, { row, canWrite });
  const provider: ComponentProps<typeof NextIntlClientProvider> = { locale: "zh", messages: zh, timeZone: "Asia/Shanghai", children };
  await act(async () => root.render(createElement(NextIntlClientProvider, provider)));
};
const stageButton = (stage: string) => container.querySelector<HTMLButtonElement>('[data-assessment-stage="' + stage + '"]')!;
const clickStage = async (stage: string) => { await act(async () => stageButton(stage).click()); };
const fill = async (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
  const prototype = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : element.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
};
const scoreField = () => container.querySelector<HTMLInputElement>('[data-assessment-field="score"] input')!;
const notesField = () => container.querySelector<HTMLTextAreaElement>('[data-followup-notes] textarea')!;
const saved = (input: { expectedRevision: number } & AssessmentWorkflowCommand) => ({ ok: true, data: {
  registrationId: id, activityId: id, participationStatus: input.command === "visit" && input.values.stage === "pending" ? "booked" : "attended",
  workflow: { ...workflow, revision: input.expectedRevision + 1, stage: input.command === "visit" ? input.values.stage : "handled" },
} });

describe("assessment stage clicks", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    actions.save.mockReset(); actions.get.mockReset(); actions.history.mockReset();
    actions.save.mockImplementation(async (input) => saved(input)); actions.get.mockResolvedValue({ ok: true, data: null });
    actions.history.mockResolvedValue({ ok: true, data: [] });
    actions.quick.mockReset(); actions.quick.mockResolvedValue({ ok: false, code: "UNKNOWN" });
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it("jumps directly to next steps and uses the materialized registration on subsequent clicks", async () => {
    await mount(); await clickStage("handled");
    expect(actions.save).toHaveBeenLastCalledWith({ registrationId: null, invitationId: id, expectedRevision: 0, command: "visit", values: { stage: "handled" } });
    expect(stageButton("handled").getAttribute("aria-current")).toBe("step");
    expect(stageButton("pending").querySelector("svg")).not.toBeNull();
    expect(stageButton("in_progress").querySelector("svg")).toBeNull();
    expect(stageButton("feedback").querySelector("svg")).toBeNull();
    expect(container.querySelector('[data-assessment-panel="handled"]')?.hasAttribute("hidden")).toBe(false);
    await clickStage("pending");
    expect(actions.save).toHaveBeenLastCalledWith({ registrationId: id, invitationId: null, expectedRevision: 1, command: "visit", values: { stage: "pending" } });
    expect(container.textContent).toContain(zh.school.assessmentWorkflow.notArrived);
  });
  it("retains an opened assessment draft across stage changes", async () => {
    await mount(); await clickStage("in_progress");
    const input = container.querySelector<HTMLTextAreaElement>('[data-assessment-panel="in_progress"] textarea')!;
    await fill(input, "Keep this unsaved note");
    await clickStage("feedback"); await clickStage("in_progress");
    expect(container.querySelector<HTMLTextAreaElement>('[data-assessment-panel="in_progress"] textarea')?.value).toBe("Keep this unsaved note");
    expect(container.querySelectorAll('[data-assessment-panel="in_progress"]')).toHaveLength(1);
  });
  it("keeps the previous view when a stage write fails", async () => {
    actions.save.mockResolvedValue({ ok: false, code: "UNKNOWN" });
    await mount(); await clickStage("feedback");
    expect(stageButton("pending").getAttribute("aria-current")).toBe("step");
    expect(container.querySelector('[data-assessment-panel="feedback"]')).toBeNull();
  });
  it("coalesces clicks while a write is pending", async () => {
    let finish: (value: unknown) => void = () => {};
    actions.save.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await mount(); await clickStage("in_progress"); await clickStage("handled");
    expect(actions.save).toHaveBeenCalledTimes(1);
    await act(async () => finish(saved({ expectedRevision: 0, command: "visit", values: { stage: "in_progress" } })));
    expect(stageButton("in_progress").getAttribute("aria-current")).toBe("step");
  });
  it("browses a classified record without any writes and requires an explicit revision reason", async () => {
    await mount({ ...initial, registrationId: id, participationStatus: "attended", workflow: { ...workflow, stage: "handled", finalizedAt: time, classification: "considering", parentResponse: "Saved parent response" } });
    await clickStage("pending"); await clickStage("feedback"); await clickStage("in_progress");
    expect(actions.save).not.toHaveBeenCalled();
    expect(scoreField().disabled).toBe(true);
    const revise = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes(zh.school.assessmentWorkflow.revise))!;
    await act(async () => revise.click());
    expect(container.querySelector('[aria-label="' + zh.school.assessmentWorkflow.revisionReason + '"]')).not.toBeNull();
    expect([...container.querySelectorAll("button")].find((button) => button.textContent === zh.school.assessmentWorkflow.confirmRevision)?.disabled).toBe(true);
    expect(actions.save).not.toHaveBeenCalled();
  });
  it("lets view-only staff browse without registering attendance or sending", async () => {
    await mount(initial, false); await clickStage("handled"); await clickStage("in_progress");
    expect(actions.save).not.toHaveBeenCalled();
    expect(scoreField().disabled).toBe(true);
  });

  it.each(["one_to_one", "activity"] as const)("keeps %s SVG labels mounted above navigation and uses one fixed right column across every stage", async (assessmentKind) => {
    await mount({ ...initial, assessmentKind, studentId: assessmentKind === "activity" ? id : null, registrationId: assessmentKind === "activity" ? id : null });
    const tags = container.querySelector("[data-assessment-tags]")!;
    const sidebar = container.querySelector("[data-followup-notes]")!;
    await fill(scoreField(), "76"); await fill(notesField(), "Shared parent concerns draft");
    for (const stage of ["in_progress", "feedback", "handled", "pending"]) {
      await clickStage(stage);
      expect(container.querySelector("[data-assessment-tags]")).toBe(tags);
      expect(tags.closest("[hidden]")).toBeNull();
      expect(tags.querySelectorAll("[data-followup-field-icon]")).toHaveLength(4);
      expect(scoreField().value).toBe("76");
      expect(container.querySelectorAll("[data-followup-notes]")).toHaveLength(1);
      expect(container.querySelector("[data-followup-notes]")).toBe(sidebar);
      expect(sidebar.closest("[data-followup-business]")).toBeNull();
      expect(sidebar.className).toContain("@[50rem]/followup-entry:col-start-2");
      expect(sidebar.className).toContain("@[50rem]/followup-entry:row-start-1");
      expect(sidebar.querySelector("[data-followup-reminder-slot] input")).not.toBeNull();
      expect(container.querySelectorAll("[data-assessment-field=score]")).toHaveLength(1);
      expect(tags.compareDocumentPosition(container.querySelector("[data-assessment-progress]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      if (stage !== "handled") expect(notesField().value).toBe("Shared parent concerns draft");
    }
    expect(actions.quick).not.toHaveBeenCalled();
  });

  it("retains classification labels, parent response and next-contact draft while browsing other stages", async () => {
    await mount(); await clickStage("handled");
    const selector = container.querySelector<HTMLSelectElement>('[data-assessment-field="classification"] select')!;
    await fill(selector, "considering"); await fill(notesField(), "Call after discussing the schedule");
    await fill(container.querySelector<HTMLInputElement>("[data-followup-reminder-slot] input")!, "2026-10-01T15:30");
    await clickStage("pending");
    expect(selector.value).toBe("considering");
    expect(container.querySelector<HTMLInputElement>("[data-followup-reminder-slot] input")?.value).toBe("2026-10-01T15:30");
    await clickStage("handled");
    expect(notesField().value).toBe("Call after discussing the schedule");
    const save = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes(zh.school.assessmentWorkflow.saveClassification))!;
    await act(async () => save.click());
    expect(actions.save).toHaveBeenLastCalledWith(expect.objectContaining({ command: "classify", values: {
      classification: "considering", parentResponse: "Call after discussing the schedule", reasons: [], nextContactAt: "2026-10-01T07:30:00.000Z",
    } }));
  });

  it("keeps edited assessment labels from being silently locked by classification", async () => {
    await mount(); await clickStage("handled");
    await fill(container.querySelector<HTMLSelectElement>('[data-assessment-field="classification"] select')!, "considering");
    await fill(scoreField(), "78");
    const save = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes(zh.school.assessmentWorkflow.saveClassification))!;
    expect(save.disabled).toBe(true);
    expect(container.textContent).toContain(zh.school.assessmentWorkflow.saveAssessmentFirst);
    const saveAssessment = [...container.querySelectorAll("button")].find((button) => button.textContent === zh.school.assessmentWorkflow.saveAssessmentDraft)!;
    await act(async () => saveAssessment.click());
    expect(actions.quick).toHaveBeenCalledWith(expect.objectContaining({ values: expect.objectContaining({ score: 78 }) }));
    expect(actions.save.mock.calls.every(([input]) => input.command === "visit")).toBe(true);
    expect(scoreField().value).toBe("78");
    expect(stageButton("handled").getAttribute("aria-current")).toBe("step");
  });
});

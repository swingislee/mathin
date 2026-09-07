// @vitest-environment jsdom
import { act, createElement, useState, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import { AssessmentRecordDetails } from "@/features/school/AssessmentRecordDetails";
import { assessmentWorkbenchStage, type AssessmentWorkbenchRow } from "@/features/school/assessment-workbench-contract";
import { assessmentWorkflowFromDb, type AssessmentWorkflowCommand } from "@/features/school/assessment-workflow-contract";

const actions = vi.hoisted(() => ({ save: vi.fn(), get: vi.fn(), history: vi.fn() }));
vi.mock("@/features/school/assessment-workflow-actions", () => ({ saveAssessmentWorkflowAction: actions.save, getAssessmentWorkflowAction: actions.get, getAssessmentWorkflowHistoryAction: actions.history }));
vi.mock("@/features/school/AssessmentQuickEntry", () => ({ AssessmentQuickEntry: ({ disabled }: { disabled: boolean }) => {
  const [draft, setDraft] = useState("");
  return createElement("input", { "data-quick-draft": true, disabled, value: draft, onInput: (event: { currentTarget: HTMLInputElement }) => setDraft(event.currentTarget.value), onChange: () => {} });
} }));
vi.mock("@/features/school/ActivityAssessmentDetails", () => ({ ActivityAssessmentDetails: () => createElement("div", null, "activity entry") }));
vi.mock("@/features/school/EnrollmentHandoffButton", () => ({ PostActivityHandoff: () => createElement("div", null, "enrollment") }));
vi.mock("@/features/school/dashboard-page/FollowupChoice", () => ({ FollowupChoice: ({ label, disabled }: { label: string; disabled: boolean }) => createElement("select", { "aria-label": label, disabled }) }));
vi.mock("@/components/ui/date-time-picker", () => ({ DateTimePicker: ({ id, value, disabled }: { id: string; value: string; disabled: boolean }) => createElement("input", { id, value, readOnly: true, disabled }) }));
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
  return createElement(AssessmentRecordDetails, { row, stage: assessmentWorkbenchStage(row), conclusion: "", locale: "zh",
    canAssess: canWrite, canQuickEntry: canWrite, canRoute: canWrite, canSupport: false, canManageAssessor: false,
    assessors: [], reassigning: false, onReassign: () => {}, onSaved: setRow, onHandoffSaved: () => {}, onNoteSaved: () => {} });
}

let root: Root; let container: HTMLDivElement;
const mount = async (row = initial, canWrite = true) => {
  const children: ReactNode = createElement(Harness, { row, canWrite });
  const provider: ComponentProps<typeof NextIntlClientProvider> = { locale: "zh", messages: zh, timeZone: "Asia/Shanghai", children };
  await act(async () => root.render(createElement(NextIntlClientProvider, provider)));
};
const stageButton = (stage: string) => container.querySelector<HTMLButtonElement>('[data-assessment-stage="' + stage + '"]')!;
const clickStage = async (stage: string) => { await act(async () => stageButton(stage).click()); };
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
    const input = container.querySelector<HTMLInputElement>("[data-quick-draft]")!;
    await act(async () => { input.value = "Keep this unsaved note"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await clickStage("feedback"); await clickStage("in_progress");
    expect(container.querySelector<HTMLInputElement>("[data-quick-draft]")?.value).toBe("Keep this unsaved note");
    expect(container.querySelectorAll("[data-quick-draft]")).toHaveLength(1);
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
    expect(container.querySelector<HTMLInputElement>("[data-quick-draft]")?.disabled).toBe(true);
    const revise = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes(zh.school.assessmentWorkflow.revise))!;
    await act(async () => revise.click());
    expect(container.querySelector('[aria-label="' + zh.school.assessmentWorkflow.revisionReason + '"]')).not.toBeNull();
    expect([...container.querySelectorAll("button")].find((button) => button.textContent === zh.school.assessmentWorkflow.confirmRevision)?.disabled).toBe(true);
    expect(actions.save).not.toHaveBeenCalled();
  });
  it("lets view-only staff browse without registering attendance or sending", async () => {
    await mount(initial, false); await clickStage("handled"); await clickStage("in_progress");
    expect(actions.save).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLInputElement>("[data-quick-draft]")?.disabled).toBe(true);
  });
});

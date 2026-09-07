import { readFileSync } from "node:fs";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import en from "../messages/en.json";
import { assessmentStageClickWrites, assessmentWorkflowFromDb, currentAssessmentReportWasSent, type AssessmentReport } from "@/features/school/assessment-workflow-contract";
import { assessmentWorkbenchStage, type AssessmentWorkbenchRow } from "@/features/school/assessment-workbench-contract";
import { AssessmentReportView } from "@/features/school/AssessmentReportView";

const fixture = vi.hoisted(() => ({ user: { id: "00000000-0000-4000-8000-000000000001" } as { id: string } | null,
  permissions: new Set(["followup.write"]), rpc: vi.fn(), state: null as unknown, events: [] as unknown[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getMyPerms: async () => fixture.permissions }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: fixture.user } }) }, rpc: fixture.rpc,
  from: () => { const query = { select: () => query, eq: () => query, order: () => query,
    maybeSingle: async () => ({ data: fixture.state, error: null }), limit: async () => ({ data: fixture.events, error: null }) }; return query; },
}) }));
import { saveAssessmentWorkflowAction } from "@/features/school/assessment-workflow-actions";

const id = "00000000-0000-4000-8000-000000000002";
const reportId = "00000000-0000-4000-8000-000000000003";
const time = "2026-09-07T03:00:00Z";
const report: AssessmentReport = { id: reportId, version: 1, created_at: time, payload: {
  schemaVersion: 1, name: "示例同学", grade: 3, gradeText: "", activityTitle: "测评", assessedAt: time, resultSource: "quick_entry",
  recordedByName: "登记老师", score: 0, totalScore: null, assessmentBand: "a", strengths: "推理清楚", focusAreas: "检查",
  teacherObservation: "", recommendation: "继续练习", recommendedClass: "A 班",
} };
const dbState = { id, registration_id: id, stage: "feedback", revision: 2, arrived_at: time,
  report_id: reportId, report, sent_report_id: null, sent_at: null, sent_by: null, classification: null,
  parent_response: "", reasons: [], next_contact_at: null, finalized_at: null, revision_reason: "", updated_by: id, updated_at: time };
const row: AssessmentWorkbenchRow = { id, assessmentKind: "one_to_one", activityId: id, activityTitle: "测评", publicClassRecord: null,
  invitationId: null, registrationId: id, studentId: null, leadId: id, name: "同学", phone: "", grade: 3, gradeText: "",
  scheduledAt: time, location: "", assessorId: null, assessorName: "", assessorSource: "assigned", background: "",
  participationStatus: "booked", assessmentStartedAt: null, assessmentCompletedAt: null, assessment: null, questionSummary: null, route: null, updatedAt: time };

describe("assessment workflow state contract", () => {
  it("treats arrival alone as in progress and respects an explicit return to check-in", () => {
    expect(assessmentWorkbenchStage({ ...row, participationStatus: "attended" })).toBe("in_progress");
    const workflow = assessmentWorkflowFromDb({ ...dbState, stage: "pending", arrived_at: null });
    expect(assessmentWorkbenchStage({ ...row, workflow, assessmentCompletedAt: time,
      route: { id, route: "continue_follow_up", note: "", updatedAt: time } })).toBe("pending");
  });
  it("keeps unlocked phase clicks writable and classified or view-only clicks read-only", () => {
    expect(assessmentStageClickWrites(null, true)).toBe(true);
    const workflow = assessmentWorkflowFromDb(dbState);
    expect(assessmentStageClickWrites(workflow, true)).toBe(true);
    expect(assessmentStageClickWrites({ ...workflow, finalizedAt: time }, true)).toBe(false);
    expect(assessmentStageClickWrites(workflow, false)).toBe(false);
  });
  it("confirms sending only for the exact current report version", () => {
    const workflow = assessmentWorkflowFromDb(dbState);
    expect(currentAssessmentReportWasSent(workflow)).toBe(false);
    expect(currentAssessmentReportWasSent({ ...workflow, sentAt: time, sentReportId: reportId })).toBe(true);
    expect(currentAssessmentReportWasSent({ ...workflow, sentAt: time, sentReportId: id })).toBe(false);
    expect(currentAssessmentReportWasSent({ ...workflow, report: null, sentAt: time, sentReportId: reportId })).toBe(false);
  });
});

describe("assessment workflow action boundary", () => {
  beforeEach(() => { fixture.user = { id }; fixture.permissions = new Set(["followup.write"]); fixture.state = dbState; fixture.rpc.mockReset();
    fixture.rpc.mockResolvedValue({ data: { registrationId: id, activityId: id, participationStatus: "attended", state: dbState }, error: null }); });
  it("submits source, version and stage as one atomic command", async () => {
    const result = await saveAssessmentWorkflowAction({ registrationId: id, invitationId: null, expectedRevision: 2, command: "visit", values: { stage: "handled" } });
    expect(result.ok).toBe(true);
    expect(fixture.rpc).toHaveBeenCalledWith("save_assessment_workflow", { p_registration_id: id, p_invitation_id: undefined,
      p_expected_revision: 2, p_command: "visit", p_values: { stage: "handled" } });
  });
  it("does not grant writes to a view-only user", async () => {
    fixture.permissions = new Set(["followup.view"]);
    const result = await saveAssessmentWorkflowAction({ registrationId: id, invitationId: null, expectedRevision: 2, command: "report", values: {} });
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" }); expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("requires a revision reason and rejects ambiguous subjects", async () => {
    expect(await saveAssessmentWorkflowAction({ registrationId: id, invitationId: null, expectedRevision: 2, command: "revise", values: { reason: " " } })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await saveAssessmentWorkflowAction({ registrationId: id, invitationId: id, expectedRevision: 2, command: "report", values: {} })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it.each(["ASSESSMENT_WORKFLOW_CONFLICT", "ASSESSMENT_WORKFLOW_FINALIZED", "ASSESSMENT_REPORT_NOT_READY"])("preserves %s for recovery", async (code) => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message: code } });
    expect(await saveAssessmentWorkflowAction({ registrationId: id, invitationId: null, expectedRevision: 2, command: "report", values: {} })).toMatchObject({ ok: false, code });
  });
});

describe("parent report contract", () => {
  it.each(["zh", "en"] as const)("renders the frozen result and truthful print action in %s", (locale) => {
    const messages = locale === "zh" ? zh : en;
    const provider: ComponentProps<typeof NextIntlClientProvider> = { locale, messages, timeZone: "Asia/Shanghai",
      children: createElement(AssessmentReportView, { report, locale }) };
    const markup = renderToStaticMarkup(createElement(NextIntlClientProvider, provider));
    expect(markup).toContain(messages.school.assessmentWorkflow.printReport);
    expect(markup).toContain("示例同学"); expect(markup).toContain("推理清楚"); expect(markup).toContain("登记老师");
    expect(markup).toMatch(/>0<\/p>/); expect(markup).toContain("A4 portrait");
    expect(markup).not.toContain("parent_response");
  });
  it("keeps reports scoped, immutable and detached from direct sending or enrollment", () => {
    const sql = readFileSync(new URL("../supabase/migrations/20260907000200_assessment_stage_workflow.sql", import.meta.url), "utf8");
    expect(sql).toContain("assessment_reports enable row level security");
    expect(sql).toContain("assessment_reports_immutable");
    expect(sql).toContain("ASSESSMENT_WORKFLOW_FINALIZED");
    expect(sql).not.toContain("insert into public.course_enrollments");
    const view = readFileSync(new URL("../src/features/school/AssessmentReportView.tsx", import.meta.url), "utf8");
    expect(view).toContain("window.print()"); expect(view).not.toContain("saveAssessmentWorkflowAction");
  });
});

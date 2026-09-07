import { describe, expect, it } from "vitest";
import { assessmentDetailStatuses, ASSESSMENT_DETAIL_STATUSES } from "@/features/school/assessment-status-contract";
import { assessmentWorkflowFromDb } from "@/features/school/assessment-workflow-contract";
import { assessmentWorkbenchStage, type AssessmentWorkbenchRow } from "@/features/school/assessment-workbench-contract";

const id = "00000000-0000-4000-8000-000000000001", time = "2026-09-07T03:00:00Z";
const workflow = assessmentWorkflowFromDb({ id, registration_id: id, stage: "feedback", revision: 1, arrived_at: time,
  report_id: null, sent_report_id: null, sent_at: null, sent_by: null, classification: null, parent_response: "", reasons: [],
  next_contact_at: null, finalized_at: null, revision_reason: "", updated_by: id, updated_at: time });
const row: AssessmentWorkbenchRow = { id, assessmentKind: "one_to_one", activityId: id, activityTitle: "Assessment", publicClassRecord: null,
  invitationId: id, registrationId: id, studentId: null, leadId: id, name: "Student", phone: "", grade: 3, gradeText: "",
  scheduledAt: time, location: "", assessorId: null, assessorName: "", assessorSource: "assigned", background: "",
  participationStatus: "booked", assessmentStartedAt: null, assessmentCompletedAt: null, assessment: null, questionSummary: null,
  route: null, updatedAt: time };

describe("fact-derived assessment detail labels", () => {
  it("has no separate registering status and keeps draft progress distinct from completion", () => {
    expect(ASSESSMENT_DETAIL_STATUSES).not.toContain("registering");
    expect(assessmentDetailStatuses(row)).toEqual(["pending"]);
    expect(assessmentDetailStatuses({ ...row, assessmentStartedAt: time })).toEqual(["continue_entry"]);
  });
  it("derives final results from saved evidence even when an old navigation stage says pending", () => {
    const final = { ...row, workflow: { ...workflow, stage: "pending" as const }, assessmentCompletedAt: time };
    expect(assessmentWorkbenchStage(final)).toBe("feedback");
    expect(assessmentDetailStatuses(final)).toEqual(["prepare_report"]);
  });
  it("distinguishes pending feedback from a saved contact with no decision", () => {
    const final = { ...row, workflow, assessmentCompletedAt: time };
    expect(assessmentDetailStatuses(final)).toEqual(["prepare_report"]);
    expect(assessmentDetailStatuses({ ...final, workflow: { ...workflow, contactedAt: time } })).toEqual(["contacting"]);
    expect(assessmentDetailStatuses({ ...final, workflow: { ...workflow, classification: "awaiting_reply" } })).toEqual(["contacting", "awaiting_reply"]);
  });
  it("combines considering and trial interest without a trial appointment", () => {
    const final = { ...row, assessmentCompletedAt: time, workflow: { ...workflow, classification: "considering" as const, trialIntent: true, contactedAt: time } };
    expect(assessmentDetailStatuses(final)).toEqual(["considering", "trial"]);
    expect(assessmentWorkbenchStage(final)).toBe("handled");
    expect(assessmentDetailStatuses({ ...final, workflow: { ...final.workflow, classification: null } })).toEqual(["trial"]);
  });
  it("reserves enrolled for actual enrollment and preserves unfinished assessment work", () => {
    const interested = { ...row, assessmentCompletedAt: time, workflow: { ...workflow, classification: "ready_to_enroll" as const } };
    expect(assessmentDetailStatuses(interested)).toEqual(["ready_to_enroll"]);
    expect(assessmentDetailStatuses({ ...interested, enrollmentId: id })).toEqual(["enrolled"]);
    expect(assessmentDetailStatuses({ ...row, assessmentStartedAt: time, enrollmentId: id })).toEqual(["continue_entry", "enrolled"]);
  });
  it("keeps cancellations and no-shows separate without erasing other attempts", () => {
    expect(assessmentDetailStatuses({ ...row, participationStatus: "cancelled" })).toEqual(["cancelled"]);
    expect(assessmentDetailStatuses({ ...row, participationStatus: "no_show" })).toEqual(["no_show"]);
    expect(assessmentDetailStatuses(row)).toEqual(["pending"]);
  });
  it("uses saved reschedule evidence rather than elapsed time", () => {
    expect(assessmentDetailStatuses({ ...row, rescheduledAt: time })).toEqual(["pending", "rescheduled"]);
    expect(assessmentDetailStatuses({ ...row, scheduledAt: "2020-01-01T00:00:00Z" })).toEqual(["pending"]);
  });
});

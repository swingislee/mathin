import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasQuickAssessmentResult, type AssessmentQuickEntryValues } from "@/features/school/assessment-quick-entry-contract";
import { assessmentWorkbenchHasFinalResult, assessmentWorkbenchStage, type AssessmentWorkbenchRow } from "@/features/school/assessment-workbench-contract";

const fixture = vi.hoisted(() => ({
  user: { id: "00000000-0000-4000-8000-000000000001" } as { id: string } | null,
  permissions: new Set(["followup.write"]), rpc: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getMyPerms: async () => fixture.permissions }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: fixture.user } }) }, rpc: fixture.rpc,
}) }));
import { saveAssessmentQuickEntryAction } from "@/features/school/assessment-quick-entry-actions";

const id = "00000000-0000-4000-8000-000000000002";
const values: AssessmentQuickEntryValues = {
  assessmentBand: "a", score: 65, strengths: "", focusAreas: "", parentConcerns: "Feedback",
  teacherRecommendation: "", recommendedClass: "", route: "continue_follow_up",
};
const quickEntry = { id, values, revision: 1, recordedBy: fixture.user!.id, recordedByName: "Support", updatedAt: "2026-09-07T01:00:00Z", finalizedAt: null };
const emptyRow: AssessmentWorkbenchRow = {
  id, assessmentKind: "one_to_one", activityId: id, activityTitle: "Assessment", publicClassRecord: null,
  invitationId: null, registrationId: id, studentId: id, leadId: null, name: "Student", phone: "", grade: 3, gradeText: "",
  scheduledAt: "2026-09-07T01:00:00Z", location: "", assessorId: null, assessorName: "", assessorSource: "assigned", background: "",
  participationStatus: "booked", assessmentStartedAt: null, assessmentCompletedAt: null, assessment: null, questionSummary: null, route: null, updatedAt: "2026-09-07T01:00:00Z",
};

describe("quick assessment result states", () => {
  it("does not turn feedback or classification alone into an academic result", () => {
    expect(hasQuickAssessmentResult({ ...values, score: null, assessmentBand: null })).toBe(false);
    expect(hasQuickAssessmentResult({ ...values, score: 0, assessmentBand: null })).toBe(true);
  });
  it("distinguishes a draft, a routed draft, a quick final and an unfinished teacher assessment", () => {
    const draft = { ...emptyRow, quickEntry, teacherRequired: true };
    expect(assessmentWorkbenchStage(draft)).toBe("in_progress");
    expect(assessmentWorkbenchHasFinalResult(draft)).toBe(false);
    const routed = { ...draft, route: { id, route: "continue_follow_up" as const, note: "", updatedAt: draft.updatedAt } };
    expect(assessmentWorkbenchStage(routed)).toBe("handled");
    expect(assessmentWorkbenchHasFinalResult(routed)).toBe(false);
    const assessment = { ...values, id, teacherObservation: "", updatedAt: draft.updatedAt, resultSource: "quick_entry" as const, finalizedAt: draft.updatedAt };
    expect(assessmentWorkbenchStage({ ...draft, assessment })).toBe("feedback");
    expect(assessmentWorkbenchHasFinalResult({ ...draft, assessment })).toBe(true);
    expect(assessmentWorkbenchHasFinalResult({ ...draft, assessment: { ...assessment, resultSource: "teacher", finalizedAt: null } })).toBe(false);
  });
});

describe("quick assessment action", () => {
  beforeEach(() => {
    fixture.user = { id: "00000000-0000-4000-8000-000000000001" };
    fixture.permissions = new Set(["followup.write"]);
    fixture.rpc.mockReset();
    fixture.rpc.mockResolvedValue({ data: {
      registrationId: id, activityId: id, recordedByName: "Support", teacherRequired: true, participationStatus: "booked", assessment: null,
      entry: { id, entry: values, revision: 1, recorded_by: fixture.user.id, updated_at: "2026-09-07T01:00:00Z", finalized_at: null },
    }, error: null });
  });
  it("accepts followup.write without review.write and uses the server-returned contributor", async () => {
    const result = await saveAssessmentQuickEntryAction({ registrationId: id, invitationId: null, values, expectedRevision: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.data.quickEntry.recordedByName).toBe("Support"); expect(result.data.assessment).toBeNull(); }
    expect(fixture.rpc).toHaveBeenCalledWith("save_assessment_quick_entry", {
      p_registration_id: id, p_invitation_id: undefined, p_entry: values, p_expected_revision: 0,
    });
  });
  it("rejects anonymous, view-only, malformed and ambiguous submissions before writing", async () => {
    const input = { registrationId: id, invitationId: null, values, expectedRevision: 0 };
    fixture.permissions = new Set(["followup.view"]);
    expect((await saveAssessmentQuickEntryAction(input)).ok).toBe(false);
    fixture.user = null;
    expect((await saveAssessmentQuickEntryAction(input)).ok).toBe(false);
    expect((await saveAssessmentQuickEntryAction({ ...input, values: { ...values, score: 10001 } })).ok).toBe(false);
    expect((await saveAssessmentQuickEntryAction({ ...input, invitationId: id })).ok).toBe(false);
    expect((await saveAssessmentQuickEntryAction({ ...input, expectedRevision: -1 })).ok).toBe(false);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("surfaces version conflicts so the client retains its draft", async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message: "ASSESSMENT_ENTRY_CONFLICT" } });
    expect(await saveAssessmentQuickEntryAction({ registrationId: id, invitationId: null, values, expectedRevision: 0 }))
      .toMatchObject({ ok: false, code: "ASSESSMENT_ENTRY_CONFLICT" });
  });
});

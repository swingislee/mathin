import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assessmentWorkbenchRowsForView, assessmentWorkbenchStage, parseAssessmentWorkbenchFilters } from "../src/features/school/assessment-workbench-contract";

const db = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, activityFilters: [] as string[], batchSizes: [] as number[] }));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      let rows = db.tables[table] ?? [];
      const query = {
        select: () => query,
        eq: (field: string, value: unknown) => {
          if (table === "activities") db.activityFilters.push(`${field}:${value}`);
          rows = rows.filter((row) => row[field] === value);
          return query;
        },
        is: (field: string, value: unknown) => { rows = rows.filter((row) => (row[field] ?? null) === value); return query; },
        in: (field: string, values: string[]) => { db.batchSizes.push(values.length); rows = rows.filter((row) => values.includes(row[field] as string)); return query; },
        order: () => query,
        limit: () => query,
        range: (start: number, end: number) => { rows = rows.slice(start, end + 1); return query; },
        returns: async () => ({ data: rows, error: null }),
      };
      return query;
    },
  }),
}));
import { listAssessmentWorkbenchRows } from "../src/features/school/assessment-workbench-data";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("unified assessment workbench", () => {
  beforeEach(() => { db.tables = {}; db.activityFilters = []; db.batchSizes = []; });

  it("opens an attached detail row while keeping the original record row and table columns fixed", () => {
    const workbench = source("src/features/school/AssessmentUnifiedWorkbench.tsx");

    expect(workbench).toContain("<DashboardCommandPanel>");
    expect(workbench).toContain("<DashboardTableShell data-assessment-unified-workbench>");
    expect(workbench).toContain('className="sticky left-0');
    expect(workbench).toContain("TeacherAssessmentEntryButton");
    expect(workbench).toContain("teacherObservation");
    expect(workbench).toContain("<FollowupTabs />");
    expect(workbench).toContain("<FollowupInlineDetails");
    expect(workbench).toContain("colSpan={7}");
    expect(workbench).toContain("table-fixed");
    expect(workbench).toContain('"h-16 cursor-pointer');
    expect(workbench).toContain('!sibling.hasAttribute("data-assessment-workbench-row")');
    expect(workbench).not.toContain('from "./dashboard-page/FollowupDetails"');
    expect(workbench).toContain('persistenceKey: "followup-assessments"');
    expect(workbench).toContain("ActivityAssessmentDetails");
    expect(workbench).toContain('assessmentTable.columnProps("kind")');
    expect(workbench).not.toContain("<Tabs");
    expect(workbench).toContain("LEARNING_CHECK_STATUS_STYLE[status]");
    expect(workbench).not.toContain("saveTeacherAssessmentQuestionAction");
  });

  it("uses one canonical route with an in-row temporary assessor handoff", () => {
    const route = source("src/app/[locale]/dashboard/followups/assessments/support-preview/page.tsx");
    const canonical = source("src/app/[locale]/dashboard/followups/assessments/page.tsx");
    const workbench = source("src/features/school/AssessmentUnifiedWorkbench.tsx");
    const action = source("src/features/school/assessment-assessor-actions.ts");
    const migration = source("supabase/migrations/20260904000400_school_ops_unified_assessment_assessor.sql");

    expect(route).toContain('redirect(`/${locale}/dashboard/followups/assessments`)');
    expect(canonical).toContain("<AssessmentUnifiedWorkbench");
    expect(canonical).not.toContain("requestedDesk");
    expect(workbench).toContain("data-assessor-reassignment");
    expect(workbench).toContain("reassignAssessmentAssessorAction");
    expect(action).toContain('"reassign_assessment_assessor"');
    expect(migration).toContain("create or replace function public.reassign_assessment_assessor");
    expect(migration).toContain("ASSESSMENT_ALREADY_COMPLETED");
    expect(migration).toContain("sync_completed_assessment_actual_assessor");
    expect(migration).toContain("assessment.actual_assessor.confirmed");
  });

  it("includes public-class group assessment records and pending students without duplicate registration rows", async () => {
    const registration = (id: string) => ({
      id, student_id: `${id}-student`, lead_id: null, status: "booked", outcome: "", assessment_paper_version_id: null,
      assessment_started_at: null, assessment_completed_at: null, updated_at: "2026-09-05T02:00:00Z",
      students: { id: `${id}-student`, name: id, phone: "", parent_phone: "", grade: 3, remark: "" }, leads: null,
    });
    db.tables.activities = [
      { id: "solo", kind: "assessment_1v1", title: "单独测评", scheduled_at: "2026-09-05T02:00:00Z", location: "A", source_invitation_id: null, activity_registrations: [registration("solo-student")] },
      { id: "public", kind: "public_class", title: "公开课", scheduled_at: "2026-09-05T03:00:00Z", location: "B", source_invitation_id: null, activity_registrations: [registration("recorded"), registration("pending")] },
    ];
    db.tables.activity_registrations = [
      { ...registration("solo-student"), activity_id: "solo" },
      { ...registration("recorded"), activity_id: "public" },
      { ...registration("pending"), activity_id: "public" },
    ];
    db.tables.public_class_segments = [{ id: "group", activity_id: "public", kind: "group_assessment", title: "集体测评", scheduled_at: "2026-09-05T04:00:00Z", location: "B2", primary_teacher_id: "teacher", primary_teacher: { display_name: "教师" } }];
    db.tables.public_class_participant_records = [{ id: "record", activity_id: "public", segment_id: "group", registration_id: "recorded", student_presence: "attended", guardian_presence: "absent", learning_observation: "思路清晰", assessment_summary: "A 班水平", parent_feedback: "关注时间", recommendation: "建议进阶", updated_at: "2026-09-05T05:00:00Z" }];

    const rows = await listAssessmentWorkbenchRows();
    expect(rows).toHaveLength(3);
    expect(db.activityFilters).not.toContain("kind:assessment_1v1");
    expect(rows.find((row) => row.assessmentKind === "one_to_one")?.registrationId).toBe("solo-student");
    const recorded = rows.find((row) => row.registrationId === "recorded")!;
    const pending = rows.find((row) => row.registrationId === "pending")!;
    expect(recorded.assessmentKind).toBe("activity");
    expect(recorded.publicClassRecord?.id).toBe("record");
    expect(recorded.assessment?.teacherObservation).toBe("A 班水平");
    expect(recorded.assessment?.parentConcerns).toBe("关注时间");
    expect(recorded.scheduledAt).toBe("2026-09-05T04:00:00Z");
    expect(assessmentWorkbenchStage(recorded)).toBe("feedback");
    expect(pending.publicClassRecord?.segmentId).toBe("group");
    expect(assessmentWorkbenchStage(pending)).toBe("pending");
    expect(assessmentWorkbenchRowsForView(rows, parseAssessmentWorkbenchFilters({}), "zh")).toHaveLength(3);
    expect(assessmentWorkbenchRowsForView(rows, parseAssessmentWorkbenchFilters({ kind: "activity" }), "zh")).toHaveLength(2);
    expect(assessmentWorkbenchRowsForView(rows, { queue: "feedback", kind: "activity" }, "zh").map((row) => row.registrationId)).toEqual(["recorded"]);
  });

  it("reads beyond the first activity page and bounds related-id query batches", async () => {
    db.tables.activities = Array.from({ length: 525 }, (_, index) => ({
      id: `activity-${index}`, kind: "assessment_1v1", title: "测评", scheduled_at: "2026-09-05T02:00:00Z", location: "A", source_invitation_id: null,
    }));
    db.tables.activity_registrations = db.tables.activities.map((activity, index) => ({
      id: `registration-${index}`, activity_id: activity.id, student_id: `student-${index}`, lead_id: null, status: "booked", outcome: "",
      assessment_paper_version_id: null, assessment_started_at: null, assessment_completed_at: null, updated_at: "2026-09-05T02:00:00Z",
      students: { id: `student-${index}`, name: `Student ${index}`, phone: "", parent_phone: "", grade: 3, remark: "" }, leads: null,
    }));
    const rows = await listAssessmentWorkbenchRows();
    expect(rows).toHaveLength(525);
    expect(rows.some((row) => row.registrationId === "registration-524")).toBe(true);
    expect(Math.max(...db.batchSizes)).toBeLessThanOrEqual(80);
  });

  it("writes activity details to their existing source record and supports keyboard save", () => {
    const details = source("src/features/school/ActivityAssessmentDetails.tsx");
    expect(details).toContain("savePublicClassParticipantRecordAction");
    expect(details).toContain("saveActivityAssessmentAction");
    expect(details).toContain('aria-keyshortcuts="Control+Enter Meta+Enter"');
    expect(details).toContain("segmentId: draft.segmentId");
    expect(details).not.toContain("saveTeacherAssessmentQuestionAction");
  });
});

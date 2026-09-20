import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import zh from "../messages/zh.json";
import en from "../messages/en.json";
import { openHistoryLocalTarget } from "../scripts/lib/history-local-target.mjs";
import { assessmentTableFields } from "@/features/school/assessment-table-fields";
import { assessmentPageStage } from "@/features/school/assessment-workbench-page";
import type { AssessmentWorkbenchRow } from "@/features/school/assessment-workbench-contract";
import type { AssessmentWorkflow } from "@/features/school/assessment-workflow-contract";
import { matchesDashboardField } from "@/features/school/dashboard-page/dashboard-table-field-contract";
import { dashboardDateSortValue, dashboardDay } from "@/features/school/dashboard-page/dashboard-table-date-contract";
import { studentListFieldLabels } from "@/features/school/student-list-query-contract";

const row: AssessmentWorkbenchRow = {
  id: "registration:fixture", assessmentKind: "one_to_one", activityId: "activity", activityTitle: "", publicClassRecord: null,
  invitationId: null, registrationId: "fixture", studentId: null, leadId: null, name: "示例", phone: "", grade: 3, gradeText: "",
  scheduledAt: "2026-09-20T16:30:00Z", location: "", assessorId: null, assessorName: "", assessorSource: "assigned",
  background: "", participationStatus: "booked", assessmentStartedAt: null, assessmentCompletedAt: null,
  assessment: null, questionSummary: null, route: null, updatedAt: "2026-09-20T15:30:00Z", recordState: "current",
};
const result = { id: "result", assessmentBand: "a" as const, score: 80, scoreMax: 100, strengths: "优势", focusAreas: "关注",
  parentConcerns: "家长", teacherRecommendation: "建议", recommendedClass: "", teacherObservation: "观察", updatedAt: row.updatedAt };
const workflow: AssessmentWorkflow = { id: "workflow", registrationId: "fixture", stage: "feedback", revision: 1, arrivedAt: null,
  report: null, sentReportId: null, sentAt: null, sentByName: "", classification: null, parentResponse: "", reasons: [], nextContactAt: null,
  trialIntent: false, contactedAt: null, finalizedAt: null, revisionReason: "", updatedAt: row.updatedAt, updatedByName: "" };

describe.skipIf(process.env.MATHIN_TABLE_PAGE_DB_TEST !== "1")("assessment SQL field values", () => {
  it("matches the UI business contract for final results, draft scores, imported closure, workflow and blank fields", () => {
    const rows: AssessmentWorkbenchRow[] = [row, { ...row, name: " \t\n\u00a0\ufeff", phone: "\t", location: "\t" },
      { ...row, assessmentStartedAt: row.updatedAt }, { ...row, participationStatus: "attended" },
      ...(["legacy", "quick_entry", "teacher"] as const).flatMap(resultSource => [false, true].flatMap(final => [null, 0, -1, 80, 101].map(score => ({ ...row,
        assessment: { ...result, score, resultSource, finalizedAt: final ? row.updatedAt : null },
        paperVersionId: "paper", questionSummary: { paperVersionId: "paper", paperTitle: "卷2", answeredCount: 1, questionCount: 3, totalScore: 100,
          outcomeCounts: {} as NonNullable<AssessmentWorkbenchRow["questionSummary"]>["outcomeCounts"], keyNotes: [] } })))),
      ...(["no_show", "cancelled", "attended"] as const).flatMap(participationStatus => ["current", "historical"].map(recordState => ({ ...row,
        sourceRecordId: "source", assessment: result, participationStatus, recordState: recordState as "current" | "historical", occurredOn: "2026-01-02" }))),
      { ...row, rescheduledAt: row.updatedAt },
      { ...row, sourceEnrollmentFacts: { version: 1, confirmed: true } as AssessmentWorkbenchRow["sourceEnrollmentFacts"] },
      ...([null, "awaiting_reply", "considering", "ready_to_enroll", "awaiting_class", "not_enrolling"] as const).flatMap(classification => [false, true].map(trialIntent => ({ ...row,
        assessment: result, workflow: { ...workflow, classification, trialIntent } }))),
      { ...row, assessment: result, enrollmentId: "enrollment", workflow },
      { ...row, assessment: result, workflow: { ...workflow, report: { id: "report", version: 1, created_at: row.updatedAt,
        payload: {} as NonNullable<AssessmentWorkflow["report"]>["payload"] }, sentReportId: "report", sentAt: row.updatedAt } },
    ];
    const { sql } = openHistoryLocalTarget({ attestationPath: ".tmp/table-page-optimization/target.json", refresh: true,
      errorFile: ".tmp/table-page-optimization/field-error.txt" });
    const literal = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
    for (const locale of ["zh", "en"] as const) {
      const t = (namespace: "school.table" | "school.assessments" | "school.supportAssessment" | "school.teacherAssessment" | "school.assessmentQuickEntry") => {
        const translate = createTranslator({ locale, messages: locale === "zh" ? zh : en, namespace });
        return (key: string, values?: Record<string, string | number>) => translate(key as Parameters<typeof translate>[0], values);
      };
      const fields = assessmentTableFields({ locale, timeZone: "Asia/Shanghai", tableT: t("school.table"), assessmentT: t("school.assessments"),
        t: t("school.supportAssessment"), teacherT: t("school.teacherAssessment"), quickT: t("school.assessmentQuickEntry"), stageFor: assessmentPageStage });
      const labels = { ...studentListFieldLabels(fields), grade: { 3: t("school.assessments")("gradeValue", { grade: 3 }) } };
      const values = JSON.parse(sql(`select jsonb_agg(public.assessment_list_fields(value,${literal(labels)},'Asia/Shanghai') order by ordinal)
        from jsonb_array_elements(${literal(rows)}) with ordinality fixture(value,ordinal)`));
      for (const [index, current] of rows.entries()) for (const [id, field] of Object.entries(fields)) {
        const actual = values[index][id], context = `${locale}/${index}/${id}`;
        expect(actual.missing, context).toBe(matchesDashboardField(current, field, { kind: "presence", value: "missing" }, locale, "Asia/Shanghai"));
        if (field.kind === "enum") expect([...new Set(actual.values)].sort(), context).toEqual(field.values(current).map(option => option.value).sort());
        if (field.kind === "text") expect(actual.text, context).toBe(field.value(current) ?? "");
        if (field.kind === "date") expect(actual.day, context).toBe(dashboardDay(field.value(current), "Asia/Shanghai"));
        const sort = field.sortValue ? field.sortValue(current) : field.kind === "enum" ? field.values(current)[0]?.label
          : field.kind === "date" ? dashboardDateSortValue(field.value(current), "Asia/Shanghai") : field.value(current);
        if (typeof sort === "number") expect(Number(actual.sort), context).toBeCloseTo(sort, 8);
        else if (sort != null && String(sort).trim()) expect(actual.sort, context).toBe(sort);
      }
    }
  }, 30000);
});

import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import zh from "../messages/zh.json";
import en from "../messages/en.json";
import { assessmentPageFilters, assessmentPageStage, assessmentSearchRows, assessmentWorkbenchFieldPage } from "@/features/school/assessment-workbench-page";
import { assessmentTableFields } from "@/features/school/assessment-table-fields";
import { dashboardFieldFacets, filterAndSortDashboardFields } from "@/features/school/dashboard-page/dashboard-table-field-contract";
import type { AssessmentWorkbenchRow } from "@/features/school/assessment-workbench-contract";
import { parseCommunicationStageFilters, studentStageHref } from "@/features/school/student-stage-contract";

function row(index: number): AssessmentWorkbenchRow {
  return { id: `registration:${index}`, assessmentKind: "one_to_one", activityId: "activity", activityTitle: "", publicClassRecord: null,
    invitationId: null, registrationId: String(index), studentId: String(index), leadId: null, name: `Student ${index}`, phone: "", grade: index % 6 + 1,
    gradeText: "", scheduledAt: "2026-09-20T10:00:00Z", location: index % 2 ? "East" : "West", assessorId: null, assessorName: "", assessorSource: "assigned",
    background: index === 1200 ? "Needle in background" : "", participationStatus: "booked", assessmentStartedAt: null, assessmentCompletedAt: null,
    assessment: null, questionSummary: null, route: null, updatedAt: "2026-09-20T10:00:00Z", recordState: index < 1230 ? "current" : "historical" };
}

describe("assessment server page", () => {
  const rows = Array.from({ length: 1250 }, (_, i) => row(i));
  for (const locale of ["zh", "en"] as const) {
    const messages = locale === "zh" ? zh : en;
    const t = (namespace: "school.table" | "school.assessments" | "school.supportAssessment" | "school.teacherAssessment" | "school.assessmentQuickEntry") => {
      const translate = createTranslator({ locale, messages, namespace });
      return (key: string, values?: Record<string, string | number>) => translate(key as Parameters<typeof translate>[0], values);
    };
    const fields = assessmentTableFields({ locale, timeZone: "Asia/Shanghai", tableT: t("school.table"), assessmentT: t("school.assessments"), t: t("school.supportAssessment"),
      teacherT: t("school.teacherAssessment"), quickT: t("school.assessmentQuickEntry"), stageFor: assessmentPageStage });
    const context = { locale, timeZone: "Asia/Shanghai", now: 0 };
    it(`${locale}: filters, sorts and computes facets across the complete authorized set before paging`, () => {
      const query = { version: 2 as const, filters: { grade: { kind: "enum" as const, values: ["1", "2"] } }, sort: { field: "name", direction: "desc" as const } };
      const all = assessmentSearchRows(rows, "", "current", locale);
      const expected = filterAndSortDashboardFields(all, fields, query, locale, context.timeZone);
      const page = assessmentWorkbenchFieldPage(rows, fields, { fields: JSON.stringify(query), page: "3", pageSize: "20" }, context);
      expect(page.rows).toEqual(expected.slice(40, 60));
      expect(page.count).toBe(expected.length);
      expect(page.fieldView.facets).toEqual(dashboardFieldFacets(all, fields, query.filters, locale, context.timeZone));
      expect(page.fieldView.facets.grade.options).toHaveLength(6);
    });
    it(`${locale}: preserves default source order, complete search and historical scope`, () => {
      expect(assessmentWorkbenchFieldPage(rows, fields, {}, context).rows).toEqual(rows.slice(0, 50));
      const found = assessmentWorkbenchFieldPage(rows, fields, { q: "needle", page: "99" }, context);
      expect(found.rows).toEqual([rows[1200]]); expect(found.page).toBe(1);
      const history = assessmentWorkbenchFieldPage(rows, fields, { state: "historical" }, context);
      expect(history.rows).toEqual(rows.slice(1230)); expect(history.count).toBe(20);
      expect(assessmentWorkbenchFieldPage(rows, fields, { state: "all" }, context).count).toBe(1250);
    });
  }
  it("normalizes malformed query values", () => {
    expect(assessmentPageFilters({ page: "NaN", pageSize: "4000", state: "bad", q: "x".repeat(150) })).toMatchObject({ page: 1, pageSize: 50, state: "current", q: "x".repeat(100) });
  });
});

describe("communication stage scope", () => {
  it.each([undefined, "work", "records", "recontact"])("ignores the retired population parameter %s", population => {
    const filters = parseCommunicationStageFilters({ population, reason: "former", stage: "awaiting_assessment", scope: "mine", page: "2" });
    expect(filters).toMatchObject({ population: "records", stage: "awaiting_assessment", scope: "mine", page: 2 });
    expect(filters.reason).toBeUndefined();
    const url = new URL(studentStageHref(filters, { page: 3 }, "/dashboard/communication"), "https://example.test");
    expect(url.searchParams.has("population")).toBe(false); expect(url.searchParams.has("reason")).toBe(false);
    expect(parseCommunicationStageFilters(Object.fromEntries(url.searchParams))).toEqual({ ...filters, page: 3 });
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hasSourceAssessmentConclusion } from "@/features/school/business-source-contract";
import { sourceCompletionMessages, sourceCompletionSummary } from "@/features/school/source-completion-contract";
import { SourceCompletionNotice } from "@/features/school/SourceCompletionNotice";
import { StudentAssessmentCompletionHint } from "@/features/school/StudentAssessmentCompletionHint";
import type { StudentStageRow } from "@/features/school/student-stage-contract";

describe("qualitative assessments keep progress and expose missing details", () => {
  it.each(["strengths", "focusAreas", "parentConcerns", "teacherRecommendation", "teacherObservation"])("recognizes attended legacy %s without inventing a score", field => {
    const assessment = { [field]: "已有文字反馈", score: null, assessmentBand: null, resultSource: "legacy" };
    expect(hasSourceAssessmentConclusion(assessment, "attended")).toBe(true);
    for (const attendance of [undefined, "booked", "no_show", "cancelled"]) expect(hasSourceAssessmentConclusion(assessment, attendance)).toBe(false);
    for (const resultSource of ["quick_entry", "teacher"]) expect(hasSourceAssessmentConclusion({ ...assessment, resultSource }, "attended")).toBe(false);
    expect(hasSourceAssessmentConclusion({ [field]: " \t\n\u00a0\u3000" }, "attended")).toBe(false);
  });

  it.each(["zh", "en"])("shows the existing completion notice without claiming enrollment in %s", locale => {
    const summary = sourceCompletionSummary([], true, [{ status: "attended", hasResult: true,
      date: "2026-09-02", score: null, band: null, teacher: "老师" }]);
    expect(summary).toEqual({ enrolled: false, knownBand: null, missing: ["assessment_score", "assessment_band"] });
    const html = renderToStaticMarkup(createElement(SourceCompletionNotice, { summary, locale }));
    const m = sourceCompletionMessages(locale);
    for (const text of [m.assessed, m.pending, m.missing.assessment_score, m.missing.assessment_band, m.assessmentBasis]) expect(html).toContain(text);
    expect(html).not.toContain(`>${m.enrolled}<`);
    expect(html).not.toContain(m.basis);
  });

  it("clears only the completed fields and keeps a real zero score", () => {
    const evidence = { status: "attended", hasResult: true, date: null, score: null, band: null, teacher: null };
    expect(sourceCompletionSummary([], true, [evidence])?.missing).toEqual(["assessment_date", "assessment_score", "assessment_teacher", "assessment_band"]);
    expect(sourceCompletionSummary([], true, [{ ...evidence, score: 0 }])?.missing).not.toContain("assessment_score");
    expect(sourceCompletionSummary([], true, [{ ...evidence, date: "2026-09-02", score: 0, band: "a", teacher: "老师" }])?.missing).toEqual([]);
    for (const status of ["booked", "no_show", "cancelled"]) expect(sourceCompletionSummary([], true, [{ ...evidence, status }])).toBeNull();
    expect(sourceCompletionSummary([], true, [{ ...evidence, hasResult: false }])).toBeNull();
  });

  it.each(["zh", "en"])("uses the shared missing-details badge in the student list in %s", locale => {
    const row = { assessmentSource: "assessment", assessmentAt: "2026-09-02", score: null, assessmentBand: null, teacherName: "老师" } as StudentStageRow;
    const html = renderToStaticMarkup(createElement(StudentAssessmentCompletionHint, { row, locale }));
    const m = sourceCompletionMessages(locale);
    expect(html).toContain("data-assessment-missing-details");
    expect(html).toContain("text-rose");
    expect(html).toContain(m.missing.assessment_score);
    expect(html).toContain(m.missing.assessment_band);
    expect(renderToStaticMarkup(createElement(StudentAssessmentCompletionHint, { row: { ...row, score: 0, assessmentBand: "a" }, locale }))).toBe("");
    for (const assessmentSource of ["class_band", null] as const) {
      expect(renderToStaticMarkup(createElement(StudentAssessmentCompletionHint, { row: { ...row, assessmentSource }, locale }))).toBe("");
    }
  });
});

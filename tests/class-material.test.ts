import { describe, expect, it } from "vitest";
import {
  compatibleMaterialRules, emptyMaterialSelection, materialRuleCourses, materialRuleInputSchema,
  materialRuleMatches, materialSelectionSchema, type MaterialCourse, type MaterialOptions, type MaterialRule,
} from "../src/features/school/class-material-contract";

const rule: MaterialRule = {
  id: "00000000-0000-0000-0000-000000000001", revisionId: "00000000-0000-0000-0000-000000000002",
  version: 1, title: "2026 new cohort", familyId: "00000000-0000-0000-0000-000000000003", familyTitle: "E",
  businessClassType: "A+", materialClassType: "A", fromYear: 2026, fromSeason: 1, toYear: 2026,
  toSeason: 2, entryGrade: 1, enabled: true, isCurrent: true, classroomCount: 0,
};
const selection = { ...emptyMaterialSelection, businessClassType: "A+", cohortYear: 2026, cohortSeason: 2, cohortGrade: 1 };
const course: MaterialCourse = {
  id: "00000000-0000-0000-0000-000000000004", title: "Grade 3 B", familyId: rule.familyId,
  familyTitle: "E", catalogVersionId: "00000000-0000-0000-0000-000000000005",
  catalogVersionTitle: "2028", catalogVersionSlug: "2028", grade: 3, season: 2, classType: "B", isSuperseded: false,
};
const options: MaterialOptions = { families: [], courses: [course, { ...course, id: "00000000-0000-0000-0000-000000000006", classType: "A" }], rules: [rule], inheritedSelection: null };

describe("class material cohort and version contract", () => {
  it("uses the original cohort as grades and catalog editions advance", () => {
    expect(materialRuleMatches(rule, course.familyId, selection)).toBe(true);
    expect(materialRuleCourses(options, course, rule).map((item) => item.classType)).toEqual(["A"]);
    expect(materialRuleMatches(rule, course.familyId, { ...selection, cohortGrade: 3 })).toBe(false);
  });
  it("does not infer unknown or older cohorts from a current A+ class", () => {
    expect(materialRuleMatches(rule, course.familyId, { ...emptyMaterialSelection, businessClassType: "A+" })).toBe(false);
    expect(materialRuleMatches(rule, course.familyId, { ...selection, cohortYear: 2025 })).toBe(false);
    expect(materialRuleMatches(rule, course.familyId, { ...selection, cohortSeason: 3 })).toBe(false);
    expect(materialRuleMatches(rule, course.familyId, { ...selection, businessClassType: "A" })).toBe(false);
  });
  it("retains a pinned revision without offering it to an unrelated new class", () => {
    const retired = { ...rule, isCurrent: false };
    expect(compatibleMaterialRules({ ...options, rules: [retired] }, course.familyId, selection)).toEqual([]);
    expect(compatibleMaterialRules({ ...options, rules: [retired] }, course.familyId, { ...selection, ruleRevisionId: retired.revisionId })).toEqual([retired]);
  });
  it("matches actual textbooks within family, grade, season and edition", () => {
    const unsuitable = [
      { ...options.courses[1], grade: 2 }, { ...options.courses[1], season: 1 },
      { ...options.courses[1], catalogVersionId: "other" }, { ...options.courses[1], familyId: "other" },
    ];
    expect(materialRuleCourses({ ...options, courses: unsuitable }, course, rule)).toEqual([]);
  });
  it("accepts an explicit manual selection and requires complete cohorts for rules", () => {
    expect(materialSelectionSchema.safeParse({ ...emptyMaterialSelection, businessClassType: " a+ " }).success).toBe(true);
    expect(materialSelectionSchema.parse({ ...emptyMaterialSelection, businessClassType: " a+ " }).businessClassType).toBe("A+");
    expect(materialSelectionSchema.safeParse({ ...emptyMaterialSelection, businessClassType: "A+", cohortYear: 2026 }).success).toBe(false);
    expect(materialSelectionSchema.safeParse({ ...emptyMaterialSelection, businessClassType: "A+", ruleRevisionId: rule.revisionId }).success).toBe(false);
    expect(materialSelectionSchema.safeParse({ ...selection, extra: "ignored?" }).success).toBe(false);
  });
  it("rejects incomplete and reversed opening ranges", () => {
    const input = { title: rule.title, familyId: rule.familyId, businessClassType: rule.businessClassType, materialClassType: rule.materialClassType, fromYear: 2026, fromSeason: 1, toYear: 2026, toSeason: 2, entryGrade: 1, enabled: true };
    expect(materialRuleInputSchema.safeParse(input).success).toBe(true);
    expect(materialRuleInputSchema.safeParse({ ...input, fromSeason: null }).success).toBe(false);
    expect(materialRuleInputSchema.safeParse({ ...input, fromSeason: 3 }).success).toBe(false);
  });
});

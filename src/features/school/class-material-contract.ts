import { z } from "zod";
import { databaseUuid } from "@/lib/database-uuid";

const uuid = databaseUuid;
const band = z.string().trim().min(1).max(20).transform((value) => value.toUpperCase());
const year = z.number().int().min(2000).max(2200).nullable();
const season = z.number().int().min(1).max(4).nullable();
const grade = z.number().int().min(1).max(12).nullable();
export const materialSelectionSchema = z.object({
  businessClassType: band,
  cohortYear: year,
  cohortSeason: season,
  cohortGrade: grade,
  ruleRevisionId: uuid.nullable(),
  inheritedFromClassroomId: uuid.nullable(),
}).strict().superRefine((value, ctx) => {
  const count = [value.cohortYear, value.cohortSeason, value.cohortGrade].filter((v) => v !== null).length;
  if ((count !== 0 && count !== 3) || (value.ruleRevisionId !== null && count !== 3)) {
    ctx.addIssue({ code: "custom", path: ["cohortYear"], message: "MATERIAL_COHORT_REQUIRED" });
  }
});
export type MaterialSelection = z.infer<typeof materialSelectionSchema>;
export const emptyMaterialSelection: MaterialSelection = {
  businessClassType: "", cohortYear: null, cohortSeason: null, cohortGrade: null,
  ruleRevisionId: null, inheritedFromClassroomId: null,
};
const ruleFields = {
  title: z.string().trim().min(1).max(100), familyId: uuid,
  businessClassType: band, materialClassType: band,
  fromYear: year, fromSeason: season, toYear: year, toSeason: season,
  entryGrade: grade, enabled: z.boolean(),
};
export const materialRuleInputSchema = z.object(ruleFields).strict().superRefine((v, ctx) => {
  if ((v.fromYear === null) !== (v.fromSeason === null) || (v.toYear === null) !== (v.toSeason === null)
    || (v.fromYear !== null && v.fromSeason !== null && v.toYear !== null && v.toSeason !== null
      && v.fromYear * 4 + v.fromSeason > v.toYear * 4 + v.toSeason)) {
    ctx.addIssue({ code: "custom", path: ["fromYear"], message: "MATERIAL_INVALID" });
  }
});
export type MaterialRuleInput = z.infer<typeof materialRuleInputSchema>;
export const materialRuleSchema = z.object({
  ...ruleFields, id: uuid, revisionId: uuid, version: z.number().int().positive(),
  familyTitle: z.string(), isCurrent: z.boolean(), classroomCount: z.number().int().nonnegative(),
});
export type MaterialRule = z.infer<typeof materialRuleSchema>;
export const materialCourseSchema = z.object({
  id: uuid, title: z.string(), familyId: uuid, familyTitle: z.string(),
  catalogVersionId: uuid, catalogVersionTitle: z.string(), catalogVersionSlug: z.string(),
  grade: z.number().int(), season, classType: z.string(), isSuperseded: z.boolean(),
});
export type MaterialCourse = z.infer<typeof materialCourseSchema>;
export const materialOptionsSchema = z.object({
  families: z.array(z.object({ id: uuid, title: z.string(), slug: z.string(), materialTypes: z.array(z.string()) })),
  courses: z.array(materialCourseSchema), rules: z.array(materialRuleSchema),
  inheritedSelection: materialSelectionSchema.nullable(),
});
export type MaterialOptions = z.infer<typeof materialOptionsSchema>;
export const materialSessionSchema = z.object({
  id: uuid, no: z.number().nullable(), title: z.string(), scheduledAt: z.string(),
  beforeLectureId: uuid.nullable(), afterLectureId: uuid.nullable(), afterTitle: z.string().nullable(),
  status: z.enum(["unchanged", "change", "preserve_history", "preserve_override", "preserve_review", "preserve_draft", "missing_lecture"]),
  hasDraft: z.boolean(),
});
export const materialPreviewSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{32}$/), selection: materialSelectionSchema,
  sessions: z.array(materialSessionSchema), changeCount: z.number(), preserveCount: z.number(),
  missingCount: z.number(), draftChangeCount: z.number(),
});
export type MaterialPreview = z.infer<typeof materialPreviewSchema>;
const historySnapshot = z.object({
  courseId: uuid.optional(), courseTitle: z.string().optional(), materialClassType: z.string().optional(),
  selection: materialSelectionSchema.nullable().optional(),
});
export const materialWorkspaceSchema = z.object({
  courseId: uuid.nullable(), courseTitle: z.string().nullable(), grade, season,
  selection: materialSelectionSchema.nullable(), options: materialOptionsSchema, editable: z.boolean(),
  history: z.array(z.object({
    id: uuid, createdAt: z.string(), reason: z.string(), before: historySnapshot, after: historySnapshot,
    changedSessions: z.number(), preservedSessions: z.number(),
  })),
});
export type MaterialWorkspace = z.infer<typeof materialWorkspaceSchema>;

/** 开班批次固定；当前年级、版本年度和导入时间均不参与新老规则匹配。 */
export function materialRuleMatches(rule: MaterialRule, familyId: string, selection: MaterialSelection) {
  const { cohortYear: y, cohortSeason: s, cohortGrade: g } = selection;
  if (y === null || s === null || g === null || rule.familyId !== familyId
    || rule.businessClassType !== selection.businessClassType.trim().toUpperCase()) return false;
  const batch = y * 4 + s;
  return (rule.entryGrade === null || rule.entryGrade === g)
    && (rule.fromYear === null || batch >= rule.fromYear * 4 + (rule.fromSeason ?? 0))
    && (rule.toYear === null || batch <= rule.toYear * 4 + (rule.toSeason ?? 0));
}

export function compatibleMaterialRules(options: MaterialOptions, familyId: string, selection: MaterialSelection) {
  return options.rules.filter((rule) => materialRuleMatches(rule, familyId, selection)
    && ((rule.isCurrent && rule.enabled) || rule.revisionId === selection.ruleRevisionId));
}

export function materialRuleCourses(options: MaterialOptions, course: MaterialCourse, rule: MaterialRule) {
  return options.courses.filter((candidate) => candidate.familyId === course.familyId
    && candidate.grade === course.grade && candidate.season === course.season
    && candidate.catalogVersionId === course.catalogVersionId && candidate.classType === rule.materialClassType);
}

export const MATERIAL_ERROR_CODES = [
  "UNAUTHENTICATED", "FORBIDDEN_SCOPE", "FORBIDDEN", "VALIDATION",
  "MATERIAL_INVALID", "MATERIAL_STALE", "MATERIAL_COURSE_UNAVAILABLE", "MATERIAL_RULE_OVERLAP",
  "MATERIAL_RULE_NOT_FOUND", "MATERIAL_RULE_MISMATCH", "MATERIAL_COHORT_REQUIRED",
  "MATERIAL_INHERITANCE_STALE", "MATERIAL_CLASS_UNAVAILABLE", "MATERIAL_REQUIRES_COURSE",
  "MATERIAL_COURSE_MISMATCH", "MATERIAL_REASON_REQUIRED", "MATERIAL_LECTURE_MISSING", "UNKNOWN",
] as const;
export type MaterialErrorCode = typeof MATERIAL_ERROR_CODES[number];
export function materialErrorCode(code: string): MaterialErrorCode {
  return MATERIAL_ERROR_CODES.find((candidate) => candidate === code) ?? "UNKNOWN";
}

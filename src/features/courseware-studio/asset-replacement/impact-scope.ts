import type { SharedAssetUsage } from "../data";

export const COURSEWARE_REPLACEMENT_IMPACT_SCOPES = [
  "page",
  "lecture",
  "course",
  "family",
  "all",
] as const;

export type CoursewareReplacementImpactScope = (typeof COURSEWARE_REPLACEMENT_IMPACT_SCOPES)[number];

export interface CoursewareReplacementImpactContext {
  pageDocId: string;
  lectureId: string;
  courseId: string;
  familyId: string;
}

export function filterCoursewareReplacementUsages(
  usages: readonly SharedAssetUsage[],
  context: CoursewareReplacementImpactContext,
  scope: CoursewareReplacementImpactScope,
) {
  if (scope === "all") return [...usages];
  return usages.filter((usage) => {
    if (scope === "page") return usage.pageDocId === context.pageDocId;
    if (scope === "lecture") return usage.lectureId === context.lectureId;
    if (scope === "course") return usage.courseId === context.courseId;
    return usage.familyId === context.familyId;
  });
}

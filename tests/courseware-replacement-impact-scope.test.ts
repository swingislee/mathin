import { describe, expect, it } from "vitest";
import {
  filterCoursewareReplacementUsages,
  type CoursewareReplacementImpactContext,
} from "@/features/courseware-studio/asset-replacement/impact-scope";
import type { SharedAssetUsage } from "@/features/courseware-studio/data";

const context: CoursewareReplacementImpactContext = {
  pageDocId: "page-1",
  lectureId: "lecture-1",
  courseId: "course-1",
  familyId: "family-1",
};

function usage(bindingId: string, pageDocId: string, lectureId: string, courseId: string, familyId: string): SharedAssetUsage {
  return {
    bindingId,
    bindingKey: bindingId,
    pageDocId,
    pageNo: 1,
    pageTitle: bindingId,
    lectureId,
    lectureNo: 1,
    lectureName: lectureId,
    courseId,
    courseTitle: courseId,
    productCode: courseId,
    familyId,
    catalogVersionId: `catalog-${familyId}`,
    pinnedRevisionId: null,
    resolvedRevisionId: "revision",
    frozenSessionCount: 0,
  };
}

describe("courseware replacement impact scopes", () => {
  const usages = [
    usage("same-page", "page-1", "lecture-1", "course-1", "family-1"),
    usage("same-lecture", "page-2", "lecture-1", "course-1", "family-1"),
    usage("same-course", "page-3", "lecture-2", "course-1", "family-1"),
    usage("same-family", "page-4", "lecture-3", "course-2", "family-1"),
    usage("outside", "page-5", "lecture-4", "course-3", "family-2"),
  ];

  it("expands monotonically from page to all references", () => {
    expect(filterCoursewareReplacementUsages(usages, context, "page").map((item) => item.bindingId)).toEqual(["same-page"]);
    expect(filterCoursewareReplacementUsages(usages, context, "lecture")).toHaveLength(2);
    expect(filterCoursewareReplacementUsages(usages, context, "course")).toHaveLength(3);
    expect(filterCoursewareReplacementUsages(usages, context, "family")).toHaveLength(4);
    expect(filterCoursewareReplacementUsages(usages, context, "all")).toHaveLength(5);
  });
});

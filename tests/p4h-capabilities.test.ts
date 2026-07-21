import { describe, expect, it } from "vitest";
import { resolveCourseCapabilities, resolveSessionCapabilities } from "@/features/school/teaching-operations/capabilities";

describe("P4H teaching-operation capabilities", () => {
  it("lets a non-teaching manager open management but never enter live teaching", () => {
    const capabilities = resolveSessionCapabilities({
      isTeaching: false,
      isSupport: false,
      isManagement: true,
      canVoidSession: true,
      canMarkAttendance: true,
      canWriteReview: true,
      canReviewVideo: true,
      canManagePostwork: true,
      state: "scheduled",
    });

    expect(capabilities.canOpenManagement).toBe(true);
    expect(capabilities.canEnterLive).toBe(false);
  });

  it("keeps research editing separate from the courseware workbench permission", () => {
    const base = {
      canViewCourse: true,
      canManageCourse: true,
      canPublishCoursewareRelease: false,
      canViewAllClasses: false,
      canCreateClass: false,
      courseStatus: "enabled" as const,
      courseTrashed: false,
      lectureStatus: "active" as const,
    };

    expect(resolveCourseCapabilities({ ...base, canEditCoursewarePage: false })).toMatchObject({
      canEditTeachingPlan: true,
      canOpenCoursewareWorkbench: false,
    });
    expect(resolveCourseCapabilities({ ...base, canEditCoursewarePage: true })).toMatchObject({
      canEditTeachingPlan: true,
      canOpenCoursewareWorkbench: true,
    });
    expect(resolveSessionCapabilities({
      isTeaching: false,
      isSupport: false,
      isManagement: false,
      canVoidSession: false,
      canMarkAttendance: false,
      canWriteReview: false,
      canReviewVideo: false,
      canManagePostwork: false,
      state: "scheduled",
    }).canEnterLive).toBe(false);
  });

  it("gives an assigned teacher preparation and live access without promoting support", () => {
    const teacher = resolveSessionCapabilities({
      isTeaching: true,
      isSupport: false,
      isManagement: false,
      canVoidSession: false,
      canMarkAttendance: true,
      canWriteReview: true,
      canReviewVideo: true,
      canManagePostwork: true,
      state: "scheduled",
    });
    const support = resolveSessionCapabilities({
      isTeaching: false,
      isSupport: true,
      isManagement: false,
      canVoidSession: false,
      canMarkAttendance: false,
      canWriteReview: false,
      canReviewVideo: false,
      canManagePostwork: false,
      state: "scheduled",
    });

    expect(teacher.canPrepare).toBe(true);
    expect(teacher.canEnterLive).toBe(true);
    expect(support.canOpenManagement).toBe(true);
    expect(support.canPrepare).toBe(false);
    expect(support.canEnterLive).toBe(false);
  });

  it("allows course metadata management without granting page editing", () => {
    const capabilities = resolveCourseCapabilities({
      canViewCourse: true,
      canManageCourse: true,
      canEditCoursewarePage: false,
      canPublishCoursewareRelease: false,
      canViewAllClasses: false,
      canCreateClass: false,
      courseStatus: "enabled",
      courseTrashed: false,
      lectureStatus: "active",
    });

    expect(capabilities.canEditTeachingPlan).toBe(true);
    expect(capabilities.canOpenCoursewareWorkbench).toBe(false);
  });
});

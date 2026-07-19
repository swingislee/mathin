import type { SessionCapabilityContext, StaffResponsibility } from "./types";

export interface TeachingRelationshipInput {
  responsibilities: readonly StaffResponsibility[];
  isTeacherOverride: boolean;
  hasClassManageScope: boolean;
  hasClassViewAll: boolean;
  hasCourseManage: boolean;
  hasSessionVoid: boolean;
  hasAttendanceMark: boolean;
  hasReviewWrite: boolean;
}

/** 将岗位权限与班级责任折叠为 capabilities 所需的对象关系，禁止 UI 再猜角色。 */
export function resolveSessionCapabilityContext(input: TeachingRelationshipInput): SessionCapabilityContext {
  const isTeaching = input.isTeacherOverride
    || input.responsibilities.includes("primary_teacher")
    || input.responsibilities.includes("assistant_teacher");
  const isSupport = input.responsibilities.includes("learning_support");
  const isManagement = input.hasClassManageScope || input.hasClassViewAll;

  return {
    isTeaching,
    isSupport,
    isManagement,
    canVoidSession: input.hasSessionVoid,
    canMarkAttendance: input.hasAttendanceMark,
    canWriteReview: input.hasReviewWrite,
    state: "scheduled",
  };
}

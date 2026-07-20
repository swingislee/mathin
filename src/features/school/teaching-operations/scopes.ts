import type { SessionCapabilityContext, StaffResponsibility, TeachingSessionState } from "./types";

export interface TeachingRelationshipInput {
  responsibilities: readonly StaffResponsibility[];
  isTeacherOverride: boolean;
  hasClassManageScope: boolean;
  hasClassViewAll: boolean;
  hasCourseManage: boolean;
  hasSessionVoid: boolean;
  hasAttendanceMark: boolean;
  hasReviewWrite: boolean;
  state: TeachingSessionState;
}

export interface SessionLifecycleColumns {
  startedAt: string | null;
  endedAt: string | null;
  deletedAt: string | null;
  cancelledBy: string | null;
  voidedAt: string | null;
}

/** 课次生命周期列 → capabilities 所需的归一化状态；UI 不自行推导取消/作废语义。 */
export function deriveSessionState(session: SessionLifecycleColumns): TeachingSessionState {
  if (session.voidedAt) return "voided";
  if (session.deletedAt && session.cancelledBy) return "cancelled";
  if (session.endedAt) return "ended";
  if (session.startedAt) return "started";
  return "scheduled";
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
    state: input.state,
  };
}

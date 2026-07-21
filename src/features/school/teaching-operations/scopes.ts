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
  hasReviewVideo: boolean;
  hasPostworkManage: boolean;
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
    canReviewVideo: input.hasReviewVideo,
    canManagePostwork: input.hasPostworkManage,
    state: input.state,
  };
}

export type SessionPrepStatus = "not_started" | "in_progress" | "ready" | null;
export type SessionWorkState = "not_ready" | "ready" | "post_pending" | "completed";

/** 工作状态（doc19 §14.2）：与事件状态是独立轴，取消/作废课次的工作态没有实际意义，统一按 not_ready 兜底。 */
export function deriveSessionWorkState(
  prepStatus: SessionPrepStatus,
  postworkCompletedAt: string | null,
  state: TeachingSessionState,
): SessionWorkState {
  if (state === "ended") return postworkCompletedAt ? "completed" : "post_pending";
  return prepStatus === "ready" ? "ready" : "not_ready";
}

export type SessionStatusLabelKey =
  | "scheduled_not_ready"
  | "scheduled_ready"
  | "imminent"
  | "live"
  | "ended_pending"
  | "completed"
  | "cancelled"
  | "voided";

const IMMINENT_WINDOW_MS = 15 * 60 * 1000;

/** doc19 §14.2 八选一复合标签；「即将开始」是已就绪且临近/已过开课时间的展示态，不落库。 */
export function computeSessionStatusLabel(
  state: TeachingSessionState,
  workState: SessionWorkState,
  scheduledAt: string | null,
  now: Date = new Date(),
): SessionStatusLabelKey {
  if (state === "cancelled") return "cancelled";
  if (state === "voided") return "voided";
  if (state === "started") return "live";
  if (state === "ended") return workState === "completed" ? "completed" : "ended_pending";
  if (workState === "ready") {
    const dueInMs = scheduledAt ? new Date(scheduledAt).getTime() - now.getTime() : Infinity;
    return dueInMs <= IMMINENT_WINDOW_MS ? "imminent" : "scheduled_ready";
  }
  return "scheduled_not_ready";
}

import type {
  ClassroomCapabilities,
  ClassroomCapabilityContext,
  CourseCapabilities,
  CourseCapabilityContext,
  SessionCapabilities,
  SessionCapabilityContext,
} from "./types";

function courseReason(
  reasons: CourseCapabilities["reasons"],
  key: keyof CourseCapabilities["reasons"],
  allowed: boolean,
  code: string,
) {
  if (!allowed) reasons[key] = code;
  return allowed;
}

function sessionReason(
  reasons: SessionCapabilities["reasons"],
  key: keyof SessionCapabilities["reasons"],
  allowed: boolean,
  code: string,
) {
  if (!allowed) reasons[key] = code;
  return allowed;
}

/**
 * P4H 的唯一课程能力公式。调用方必须在服务端先完成 scope 判定，客户端只消费结果。
 */
export function resolveCourseCapabilities(context: CourseCapabilityContext): CourseCapabilities {
  const reasons: CourseCapabilities["reasons"] = {};
  const manageable = context.canManageCourse && !context.courseTrashed;
  const viewable = context.canViewCourse;
  const usableForNewClass = context.courseStatus === "enabled" && !context.courseTrashed;

  const canEditFamily = courseReason(reasons, "familyEdit", manageable, context.courseTrashed ? "COURSE_TRASHED" : "FORBIDDEN");
  const canManageVariants = courseReason(reasons, "variantManage", manageable, context.courseTrashed ? "COURSE_TRASHED" : "FORBIDDEN");
  const canEditTeachingPlan = courseReason(reasons, "planEdit", manageable, context.courseTrashed ? "COURSE_TRASHED" : "FORBIDDEN");
  const canOpenCoursewareWorkbench = courseReason(
    reasons,
    "workbench",
    viewable && context.canEditCoursewarePage && !context.courseTrashed,
    context.courseTrashed ? "COURSE_TRASHED" : "FORBIDDEN",
  );
  const canPublishRelease = courseReason(
    reasons,
    "publish",
    viewable && context.canPublishCoursewareRelease && !context.courseTrashed,
    context.courseTrashed ? "COURSE_TRASHED" : "FORBIDDEN",
  );
  const canTransitionFamily = courseReason(reasons, "familyTransition", manageable, context.courseTrashed ? "COURSE_TRASHED" : "FORBIDDEN");
  const canTransitionVariant = courseReason(reasons, "variantTransition", manageable, context.courseTrashed ? "COURSE_TRASHED" : "FORBIDDEN");
  const canArchiveLecture = courseReason(
    reasons,
    "lectureArchive",
    manageable && context.lectureStatus !== undefined,
    context.courseTrashed ? "COURSE_TRASHED" : "FORBIDDEN",
  );
  const canViewUsingClasses = courseReason(
    reasons,
    "usingClasses",
    context.canViewAllClasses || context.canManageCourse,
    "FORBIDDEN",
  );
  const canCreateClass = courseReason(
    reasons,
    "createClass",
    context.canCreateClass && usableForNewClass,
    context.courseTrashed ? "COURSE_TRASHED" : "COURSE_NOT_ENABLED",
  );

  return {
    canViewFamily: viewable,
    canViewVariant: viewable,
    canPreviewLecture: viewable && context.lectureStatus === "active",
    canEditFamily,
    canManageVariants,
    canEditTeachingPlan,
    canOpenCoursewareWorkbench,
    canPublishRelease,
    canTransitionFamily,
    canTransitionVariant,
    canArchiveLecture,
    canViewUsingClasses,
    canCreateClass,
    reasons,
  };
}

function classroomReason(
  reasons: ClassroomCapabilities["reasons"],
  key: keyof ClassroomCapabilities["reasons"],
  allowed: boolean,
  code: string,
) {
  if (!allowed) reasons[key] = code;
  return allowed;
}

/** P4H 的唯一班级能力公式；教学/学辅/管理关系由服务端查询层折叠后传入。 */
export function resolveClassroomCapabilities(context: ClassroomCapabilityContext): ClassroomCapabilities {
  const reasons: ClassroomCapabilities["reasons"] = {};
  const canViewClassroom = context.isTeaching || context.isSupport || context.isManagement;
  const manageable = context.isManagement && !context.classroomTrashed;

  const canManageClassroom = classroomReason(reasons, "manage", manageable, context.classroomTrashed ? "CLASSROOM_TRASHED" : "FORBIDDEN");
  const canPrepareTeaching = classroomReason(reasons, "prepare", context.isTeaching, "FORBIDDEN");
  const canManageSchedule = classroomReason(reasons, "schedule", manageable, context.classroomTrashed ? "CLASSROOM_TRASHED" : "FORBIDDEN");

  return {
    canViewClassroom,
    canManageClassroom,
    canPrepareTeaching,
    canViewSchedule: canViewClassroom,
    canManageSchedule,
    reasons,
  };
}

/** P4H 的唯一课次能力公式；状态由服务端查询层归一化后传入。 */
export function resolveSessionCapabilities(context: SessionCapabilityContext): SessionCapabilities {
  const reasons: SessionCapabilities["reasons"] = {};
  const openManagement = context.isManagement || context.isSupport;
  const isScheduled = context.state === "scheduled";
  const isLiveEligible = context.state === "scheduled" || context.state === "started";
  const isCompleted = context.state === "ended" || context.state === "voided";

  const canPrepare = sessionReason(reasons, "prepare", context.isTeaching && isScheduled, "FORBIDDEN_SCOPE");
  const canEnterLive = sessionReason(reasons, "live", context.isTeaching && isLiveEligible, "FORBIDDEN_SCOPE");
  const canReschedule = sessionReason(reasons, "reschedule", context.isManagement && isScheduled, "FORBIDDEN_SCOPE");
  const canAssignSubstitute = sessionReason(reasons, "substitute", context.isManagement && isScheduled, "FORBIDDEN_SCOPE");
  const canCancel = sessionReason(reasons, "cancel", context.isManagement && isScheduled, "SESSION_ALREADY_STARTED");
  const canRestore = sessionReason(reasons, "restore", context.isManagement && context.state === "cancelled", "SESSION_NOT_CANCELLED");
  const canVoid = sessionReason(reasons, "void", context.isManagement && context.canVoidSession && context.state === "ended", "FORBIDDEN_SCOPE");
  const canViewReport = sessionReason(reasons, "report", openManagement || context.isTeaching, "FORBIDDEN_SCOPE");
  const canMarkAttendance = sessionReason(
    reasons,
    "attendance",
    context.canMarkAttendance && (context.isTeaching || context.isManagement) && isLiveEligible,
    "FORBIDDEN_SCOPE",
  );
  const canWriteReview = sessionReason(
    reasons,
    "review",
    context.canWriteReview && (context.isTeaching || context.isManagement) && isCompleted,
    "FORBIDDEN_SCOPE",
  );

  return {
    canOpenManagement: openManagement,
    canPrepare,
    canEnterLive,
    canReschedule,
    canAssignSubstitute,
    canCancel,
    canRestore,
    canVoid,
    canViewReport,
    canMarkAttendance,
    canWriteReview,
    reasons,
  };
}

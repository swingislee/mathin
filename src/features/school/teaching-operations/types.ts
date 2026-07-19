export type CoursePurpose = "production" | "test";
export type CourseStatus = "draft" | "enabled" | "disabled";
export type LectureStatus = "draft" | "active" | "archived";
export type CourseSeason = 1 | 2 | 3 | 4;

export type ClassroomPurpose = "production" | "test";
export type ClassroomOperationalStatus = "planning" | "active" | "completed";
export type StaffResponsibility = "primary_teacher" | "assistant_teacher" | "learning_support";

export interface CourseCapabilities {
  canViewFamily: boolean;
  canViewVariant: boolean;
  canPreviewLecture: boolean;
  canEditFamily: boolean;
  canManageVariants: boolean;
  canEditTeachingPlan: boolean;
  canOpenCoursewareWorkbench: boolean;
  canPublishRelease: boolean;
  canTransitionFamily: boolean;
  canTransitionVariant: boolean;
  canArchiveLecture: boolean;
  canViewUsingClasses: boolean;
  canCreateClass: boolean;
  reasons: Partial<Record<
    "familyEdit" | "variantManage" | "planEdit" | "workbench" |
    "publish" | "familyTransition" | "variantTransition" |
    "lectureArchive" | "usingClasses" | "createClass",
    string
  >>;
}

export interface SessionCapabilities {
  canOpenManagement: boolean;
  canPrepare: boolean;
  canEnterLive: boolean;
  canReschedule: boolean;
  canAssignSubstitute: boolean;
  canCancel: boolean;
  canRestore: boolean;
  canVoid: boolean;
  canViewReport: boolean;
  canMarkAttendance: boolean;
  canWriteReview: boolean;
  reasons: Partial<Record<
    "prepare" | "live" | "reschedule" | "substitute" | "cancel" |
    "restore" | "void" | "report" | "attendance" | "review",
    string
  >>;
}

export type TeachingSessionState = "scheduled" | "started" | "ended" | "cancelled" | "voided";

/** Server query 层已把岗位权限、对象关系和当前状态折叠为这些布尔值；UI 不自行推导。 */
export interface CourseCapabilityContext {
  canViewCourse: boolean;
  canManageCourse: boolean;
  canEditCoursewarePage: boolean;
  canPublishCoursewareRelease: boolean;
  canViewAllClasses: boolean;
  canCreateClass: boolean;
  courseStatus: CourseStatus;
  courseTrashed: boolean;
  lectureStatus?: LectureStatus;
}

export interface SessionCapabilityContext {
  isTeaching: boolean;
  isSupport: boolean;
  isManagement: boolean;
  canVoidSession: boolean;
  canMarkAttendance: boolean;
  canWriteReview: boolean;
  state: TeachingSessionState;
}

export type CoursePurpose = "production" | "test";
export type CourseStatus = "draft" | "enabled" | "disabled";
export type LectureStatus = "draft" | "active" | "archived";
/** courses.term 的产品季节值（1=暑期、2=秋季、3=寒假、4=春季），不是 school_terms 的运营学期。 */
export type CourseSeason = 1 | 2 | 3 | 4;

/** 不依赖 server-only 数据层的纯常量，client 组件（矩阵/新建版本弹窗）可直接引入。 */
export const COURSE_SEASONS = [
  { value: 1, labelKey: "summer" },
  { value: 2, labelKey: "autumn" },
  { value: 3, labelKey: "winter" },
  { value: 4, labelKey: "spring" },
] as const satisfies ReadonlyArray<{ value: CourseSeason; labelKey: string }>;
export type ClassroomScope = "teaching" | "support" | "all" | "test";

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

export interface CourseFamilySummary {
  id: string;
  slug: string;
  title: string;
  publisher: string;
  stage: string;
  subject: string;
  edition: string;
  purpose: CoursePurpose;
  status: CourseStatus;
  variantCount: number;
  lectureCount: number;
  matchedVariants: CourseVariantSummary[];
}

export interface CourseVariantSummary {
  id: string;
  title: string;
  productCode: string | null;
  grade: number;
  courseSeason: CourseSeason;
  classType: string;
  lectureCount: number;
  releasedLectureCount: number;
}

export type CourseAssignmentResponsibility = "owner" | "editor" | "reviewer";

/** 课程责任行（family/variant 两级），含已归档的历史记录。 */
export interface CourseAssignment {
  id: string;
  userId: string;
  userName: string;
  responsibility: CourseAssignmentResponsibility;
  createdAt: string;
  archivedAt: string | null;
}

/** 版本使用情况：引用该版本的班级。 */
export interface ClassroomUsage {
  id: string;
  name: string;
  operationalStatus: ClassroomOperationalStatus;
  archivedAt: string | null;
}

export interface ClassroomCapabilities {
  canViewClassroom: boolean;
  canManageClassroom: boolean;
  canPrepareTeaching: boolean;
  canViewSchedule: boolean;
  canManageSchedule: boolean;
  reasons: Partial<Record<"manage" | "prepare" | "schedule", string>>;
}

/** Server query 层已把岗位权限、责任关系和班级生命周期折叠为这些布尔值；UI 不自行推导。 */
export interface ClassroomCapabilityContext {
  isTeaching: boolean;
  isSupport: boolean;
  isManagement: boolean;
  classroomTrashed: boolean;
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

/** 既有客户端的业务 DTO；小程序专用命名见 contracts/participant-api/portal.ts。 */
export type Locale = "zh" | "en";
export type LocalizedText = { zh: string; en: string };
export type FormField = {
  id: string;
  type: "text" | "phone" | "textarea" | "select" | "multiselect";
  label: LocalizedText;
  required: boolean;
  options?: { id: string; label: LocalizedText }[];
};
export type IntakeForm = {
  slug: string; version: number; title: LocalizedText; description: LocalizedText;
  privacyNotice: LocalizedText; fields: FormField[];
};
export type Participant = { id: string; name: string };
export type Activity = {
  id: string; title: LocalizedText; description: LocalizedText; location: string;
  startsAt: string; durationMinutes: number | null; remaining: number | null;
  bookable: boolean;
  /** 发现筛选：null/缺省表示待核对，空数组表示不限年级。 */
  targetGrades?: number[] | null;
  /** Mathin 公开数学课程为 math；未分类项目为 null。 */
  subject?: "math" | null;
};
export type Booking = {
  id: string; activityId: string; participantId: string; participantName: string;
  title: LocalizedText; startsAt: string; location: string;
  status: "booked" | "attended" | "no_show" | "cancelled"; canCancel?: boolean;
};
export type Report = {
  id: string; kind: "assessment" | "feedback"; title: string;
  /** 旧版 assessment RPC 尚未升级时为 null；客户端仅使用 ID 关联孩子。 */
  participantId: string | null;
  participantName: string; date: string; summary: string; strengths: string;
  focusAreas: string; recommendation: string; score: number | null; totalScore: number | null;
  sections?: import("../participant-api/report-template").ReportSection[];
  referenceValidity?: import("./assessment-result-validity").AssessmentReferenceValidity;
};
export type Practice = {
  id: string; participantId: string; participantName: string; title: string;
  instructions: string; dueAt: string | null; submittedAt: string | null;
  submissionRules?: import("../participant-api/task-submission").TaskSubmissionRules;
};
export type Media = { id: string; kind: "image" | "video"; name: string; bytes: number; url?: string };
export type PracticeSubmission = { id: string; submittedAt: string; note: string; media: Media[]; submissionRules?: import("../participant-api/task-submission").TaskSubmissionRules };
export type Session = { accessToken: string; refreshToken: string; expiresAt: number };
/** available 表示服务端配置就绪；真实微信往返仍由登录操作核验。 */
export type ParentWechatAuthStatus = { available: boolean; linked: boolean | null; canBind: boolean; canBindDirect?: boolean; registrationRequired?: boolean };
export type ParentWechatAuthCommand =
  | { action: "login"; code: string; scene?: string }
  | { action: "bind"; code: string; password?: string; confirm: true };
export type ParentWechatAuthResult =
  | { state: "authenticated"; session: Session }
  | { state: "binding_required" }
  | { state: "onboarding_required"; ticket: string; phoneVerified?: boolean }
  | { state: "current_session" }
  | { state: "bound" };
export type ParentWechatAuthErrorReason = "WECHAT_NOT_CONFIGURED" | "WECHAT_CODE_INVALID"
  | "WECHAT_UNIONID_REQUIRED" | "WECHAT_CREDENTIALS_INVALID" | "WECHAT_MFA_REQUIRED"
  | "WECHAT_PHONE_LINKING_UNAVAILABLE";
export type ParentWechatAuthError = { code: ApiErrorCode; reason?: ParentWechatAuthErrorReason };
export type Account = { id: string; displayName: string; participants: Participant[] };
export type LearningSummary = {
  grade: number | null; nextSessionAt: string | null; weekSessionCount: number; starTotal: number;
};
/** 当前课表窗口内的班级投影；sessionCount 表示窗口内课次，不表示已购或剩余课时。 */
export type LearningCourse = {
  id: string; name: string; teacherName: string | null; nextSessionAt: string | null; sessionCount: number;
};
export type LearningSession = {
  id: string; participantId: string; classroomId: string; classroomName: string; title: string;
  startsAt: string; durationMinutes: number | null; teacherName: string | null;
};
export type LearningAttendance = {
  sessionId: string; participantId: string; classroomName: string; title: string; startsAt: string;
  status: "present" | "absent" | "late" | "leave"; note: string;
};
/** 当前账号的通知；其中 participantId=null 表示通知未指定孩子。 */
export type LearningNotification = {
  id: string; type: string; occurredAt: string; readAt: string | null; link: string | null;
  participantId: string | null; studentName: string | null; classroomName: string | null; sessionTitle: string | null;
};
export type LearningLeaveRequest = {
  id: string; sessionId: string; participantId: string; sessionTitle: string; reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled"; createdAt: string; decidedAt: string | null;
  makeupSessionId: string | null; makeupSessionTitle: string | null; makeupClassroomName: string | null;
  makeupStartsAt: string | null; makeupStatus: "to_schedule" | "scheduled" | "completed" | "cancelled" | null;
};
export type LearningCapabilities = {
  leaveRequests: boolean; notificationRead: boolean; chat: boolean; rescheduling: boolean;
  wrongAnswers: boolean; profileEditing: boolean; payments: boolean;
};
export type ParentLearning = {
  participantId: string; generatedAt: string; range: { from: string; to: string };
  summary: LearningSummary | null; courses: LearningCourse[]; schedule: LearningSession[];
  attendance: LearningAttendance[]; notifications: LearningNotification[];
  leaveRequests: LearningLeaveRequest[]; reports: Report[];
  /** 当前账号中旧接口缺少孩子 ID 的报告数；不把它们归入任意孩子。 */
  unassignedReportCount: number; capabilities: LearningCapabilities;
};
export type LearningCommand =
  | { action: "leave"; sessionId: string; participantId: string; reason: string }
  | { action: "readNotification"; id: string };
export type AssessmentState = "coordinating_time" | "awaiting_teacher" | "awaiting_parent"
  | "confirmed" | "completed" | "cancelled";
export type AssessmentEligibilityReason = "NO_LINKED_LEAD" | "AMBIGUOUS_LINKED_LEAD"
  | "LEAD_UNAVAILABLE" | "ACTIVE_INVITATION" | "NO_ELIGIBLE_TEACHER";
export type AssessmentTeacher = { id: string; displayName: string };
/** Stable identifier in the backend diagnostic-topic catalog. */
export type AssessmentSubject = string;
export type AssessmentTopicOption = { id: string; label: { zh: string; en: string }; available: boolean };
export type AssessmentSlot = {
  id: string; teacherId: string; campusId: string; startsAt: string; endsAt: string; available: boolean; mode?: "campus" | "online";
};
export type AssessmentAvailability = {
  policy?: import("../participant-api/booking-policy").BookingPolicy;
  participantId: string; timeZone: "Asia/Shanghai"; from: string; to: string;
  teachers: AssessmentTeacher[]; campuses: { id: string; name: string }[]; slots: AssessmentSlot[];
};
export type AssessmentBookingDetails = {
  slotId: string; subjects: AssessmentSubject[]; grade: number; mode: "campus" | "online";
  campus: { id: string; name: string }; endsAt: string; joiningInstructions?: string;
};
/** 时间选项为 Asia/Shanghai 的 YYYY-MM-DD@时段；它表示协调意向，不表示教师空闲库存。 */
export type ParentAssessmentRequest = {
  id: string; participantId: string; teacher: AssessmentTeacher | null; state: AssessmentState;
  parentTimeOptions: string[]; teacherTimeOptions: string[];
  /** 双方交集中未来可确认的精确时段，排序去重；不含 after_school。 */
  sharedTimeOptions: string[];
  /** awaiting_parent 时已提出的预约时刻；尚未提出或其他状态为 null。 */
  proposedStartsAt: string | null;
  /** confirmed/completed 的实际预约时刻；不是确认操作发生时间。 */
  scheduledAt: string | null;
  updatedAt: string; canConfirm: boolean; canCancel?: boolean; cancelUntil?: string | null;
  /** 已发布时段的预约信息；早期双边意向邀约没有此字段。 */
  booking?: AssessmentBookingDetails | null;
};
export type ParentAssessmentOverview = {
  policy?: import("../participant-api/booking-policy").BookingPolicy;
  topics?: AssessmentTopicOption[];
  participantId: string; timeZone: "Asia/Shanghai";
  eligibility: { canRequest: boolean; reason: AssessmentEligibilityReason | null };
  teachers: AssessmentTeacher[]; requests: ParentAssessmentRequest[];
};
export type AssessmentRequestCommand = {
  action: "request";
  /** 客户端生成并在结果不明时保留的稳定 UUID；成功后作为邀约 ID。 */
  id: string; participantId: string; teacherId: string; parentTimeOptions: string[];
};
export type AssessmentConfirmCommand = {
  action: "confirm"; id: string; participantId: string;
  /** 选择该邀约双边交集中的未来精确时段；after_school 只作为意向。 */
  timeOption: string; expectedUpdatedAt: string;
};
export type AssessmentBookCommand = {
  action: "book"; id: string; participantId: string; slotId: string;
  subjects: AssessmentSubject[]; grade: number; mode: "campus" | "online";
};
export type AssessmentCommand = AssessmentRequestCommand | AssessmentConfirmCommand | AssessmentBookCommand
  | { action: "cancel"; id: string; participantId: string };
export type ApiErrorCode = "VALIDATION" | "UNAUTHENTICATED" | "FORBIDDEN" | "ACCOUNT_SECURITY"
  | "NOT_FOUND" | "FORM_CHANGED" | "ACTIVITY_FULL" | "BOOKING_CLOSED" | "CONFLICT"
  | "TOO_LARGE" | "FILE_TYPE" | "RATE_LIMIT" | "UNAVAILABLE";

/** Explicitly published classes; teaching course links may be absent for short classes. */
export type CatalogClass = {
  id: string; name: string; offeringType?: "long_term_formal" | "short_term_topic";
  courseId: string | null; familyId: string | null; familyTitle: string;
  grade: number | null; subject: string; level: string; termId: string | null; termName: string;
  campusId: string | null; campusName: string | null; roomName: string | null;
  remaining: number | null; teachers: { id: string; name: string }[];
  sessions: { at: string; duration: number }[];
};
export type CourseOffer = {
  id: string; kind: "class" | "activity"; title: string; description: string; priceCents: number | null;
  bookingClosesAt: string; revision: number; classes: CatalogClass[];
  activity: { id: string; tags?: string[]; targetGrades: number[] | null; location: string; startsAt: string;
    durationMinutes: number | null; remaining: number | null } | null;
};
export type CourseApplication = {
  id: string; kind: "class" | "activity"; participantId: string; participantName: string; publicationId: string;
  classroomId: string | null; activityId: string | null; title: string; className: string; priceCents: number | null;
  status: "pending" | "contacted" | "confirmed" | "declined" | "cancelled";
  createdAt: string; resolvedAt: string | null; reply: string;
};
export type CourseApplicationCommand = { action: "apply"; id: string; publicationId: string;
  kind: "class" | "activity"; revision: number; classroomId: string | null; participantId: string } | { action: "cancel"; id: string };
export type AdvisorContact = { grade: number; teacherName: string; phone: string; qrCodeUrl: string };

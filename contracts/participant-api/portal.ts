/** 小程序专用 API 合同。服务端映射既有业务数据；共享表和其他客户端沿用原合同。 */
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
  /** 发现筛选：null/缺省表示待核对，空数组表示不限阶段。 */
  targetStages?: number[] | null;
  /** 未明确分类的项目为 null。 */
  topic?: "math" | "english" | null;
};
export type Booking = {
  id: string; activityId: string; participantId: string; participantName: string;
  title: LocalizedText; startsAt: string; location: string;
  status: "booked" | "attended" | "no_show" | "cancelled";
};
export type Report = {
  id: string; kind: "assessment" | "feedback"; title: string;
  /** 旧版 assessment RPC 尚未升级时为 null；客户端仅使用 ID 关联参与人。 */
  participantId: string | null;
  participantName: string; date: string; summary: string; strengths: string;
  focusAreas: string; recommendation: string; score: number | null; totalScore: number | null;
};
export type ActivityTask = {
  id: string; participantId: string; participantName: string; title: string;
  instructions: string; dueAt: string | null; submittedAt: string | null;
};
export type Media = { id: string; kind: "image" | "video"; name: string; bytes: number; url?: string };
export type TaskSubmission = { id: string; submittedAt: string; note: string; media: Media[] };
export type Session = { accessToken: string; refreshToken: string; expiresAt: number };
/** available 表示服务端配置就绪；真实微信往返仍由登录操作核验。 */
export type WechatAuthStatus = { available: boolean; linked: boolean | null; canBind: boolean };
export type WechatAuthCommand =
  | { action: "login"; code: string; scene?: string }
  | { action: "bind"; code: string; password: string; confirm: true };
export type WechatAuthResult =
  | { state: "authenticated"; session: Session }
  | { state: "onboarding_required"; ticket: string }
  | { state: "binding_required" }
  | { state: "bound" };
export type WechatAuthErrorReason = "WECHAT_NOT_CONFIGURED" | "WECHAT_CODE_INVALID"
  | "WECHAT_UNIONID_REQUIRED" | "WECHAT_CREDENTIALS_INVALID" | "WECHAT_MFA_REQUIRED"
  | "WECHAT_PHONE_LINKING_UNAVAILABLE";
export type WechatAuthError = { code: ApiErrorCode; reason?: WechatAuthErrorReason };
export type Account = { id: string; displayName: string; participants: Participant[] };
export type CalendarSummary = {
  stageNumber: number | null; nextSessionAt: string | null; weekSessionCount: number; starTotal: number;
};
/** 当前日历窗口内的分组；sessionCount 只统计窗口内安排。 */
export type CalendarGroup = {
  id: string; name: string; facilitatorName: string | null; nextSessionAt: string | null; sessionCount: number;
};
export type CalendarEntry = {
  id: string; participantId: string; groupId: string; groupName: string; title: string;
  startsAt: string; durationMinutes: number | null; facilitatorName: string | null;
};
export type ParticipationRecord = {
  sessionId: string; participantId: string; groupName: string; title: string; startsAt: string;
  status: "present" | "absent" | "late" | "leave"; note: string;
};
/** 当前账号的通知；其中 participantId=null 表示通知未指定参与人。 */
export type AccountNotice = {
  id: string; type: string; occurredAt: string; readAt: string | null; link: string | null;
  participantId: string | null; participantName: string | null; groupName: string | null; sessionTitle: string | null;
};
export type AbsenceRequest = {
  id: string; sessionId: string; participantId: string; sessionTitle: string; reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled"; createdAt: string; decidedAt: string | null;
  makeupSessionId: string | null; makeupSessionTitle: string | null; makeupGroupName: string | null;
  makeupStartsAt: string | null; makeupStatus: "awaiting_time" | "time_confirmed" | "completed" | "cancelled" | null;
};
export type PortalCapabilities = {
  leaveRequests: boolean; notificationRead: boolean; chat: boolean; rebooking: boolean;
  wrongAnswers: boolean; profileEditing: boolean; payments: boolean;
};
export type ParticipantCalendar = {
  participantId: string; generatedAt: string; range: { from: string; to: string };
  summary: CalendarSummary | null; groups: CalendarGroup[]; calendar: CalendarEntry[];
  attendance: ParticipationRecord[]; notifications: AccountNotice[];
  leaveRequests: AbsenceRequest[]; reports: Report[];
  /** 当前账号中旧接口缺少参与人 ID 的报告数；保留未分配状态。 */
  unassignedReportCount: number; capabilities: PortalCapabilities;
};
export type CalendarCommand =
  | { action: "leave"; sessionId: string; participantId: string; reason: string }
  | { action: "readNotification"; id: string };
export type AssessmentState = "coordinating_time" | "awaiting_facilitator" | "awaiting_participant"
  | "confirmed" | "completed" | "cancelled";
export type AssessmentEligibilityReason = "NO_LINKED_LEAD" | "AMBIGUOUS_LINKED_LEAD"
  | "LEAD_UNAVAILABLE" | "ACTIVE_INVITATION" | "NO_ELIGIBLE_FACILITATOR";
export type AssessmentFacilitator = { id: string; displayName: string };
export type AssessmentTopic = "math" | "english";
export type AssessmentSlot = {
  id: string; facilitatorId: string; campusId: string; startsAt: string; endsAt: string; available: boolean;
};
export type AssessmentAvailability = {
  participantId: string; timeZone: "Asia/Shanghai"; from: string; to: string;
  facilitators: AssessmentFacilitator[]; campuses: { id: string; name: string }[]; slots: AssessmentSlot[];
};
export type AssessmentBookingDetails = {
  slotId: string; topics: AssessmentTopic[]; stageNumber: number; mode: "campus";
  campus: { id: string; name: string }; endsAt: string;
};
/** 时间选项为 Asia/Shanghai 的 YYYY-MM-DD@时段；协调意向与已发布可约时段分别保存。 */
export type AssessmentRequest = {
  id: string; participantId: string; facilitator: AssessmentFacilitator | null; state: AssessmentState;
  participantTimeOptions: string[]; facilitatorTimeOptions: string[];
  /** 双方交集中未来可确认的精确时段，排序去重；不含 after_school。 */
  sharedTimeOptions: string[];
  /** awaiting_participant 时已提出的预约时刻；尚未提出或其他状态为 null。 */
  proposedStartsAt: string | null;
  /** confirmed/completed 的实际预约时刻；不是确认操作发生时间。 */
  confirmedStartsAt: string | null;
  updatedAt: string; canConfirm: boolean;
  /** 已发布时段的预约信息；早期双边意向邀约没有此字段。 */
  booking?: AssessmentBookingDetails | null;
};
export type AssessmentOverview = {
  participantId: string; timeZone: "Asia/Shanghai";
  eligibility: { canRequest: boolean; reason: AssessmentEligibilityReason | null };
  facilitators: AssessmentFacilitator[]; requests: AssessmentRequest[];
};
export type AssessmentRequestCommand = {
  action: "request";
  /** 客户端生成并在结果不明时保留的稳定 UUID；成功后作为邀约 ID。 */
  id: string; participantId: string; facilitatorId: string; participantTimeOptions: string[];
};
export type AssessmentConfirmCommand = {
  action: "confirm"; id: string; participantId: string;
  /** 选择该邀约双边交集中的未来精确时段；after_school 只作为意向。 */
  timeOption: string; expectedUpdatedAt: string;
};
export type AssessmentBookCommand = {
  action: "book"; id: string; participantId: string; slotId: string;
  topics: AssessmentTopic[]; stageNumber: number; mode: "campus";
};
export type AssessmentCommand = AssessmentRequestCommand | AssessmentConfirmCommand | AssessmentBookCommand;
export type ApiErrorCode = "VALIDATION" | "UNAUTHENTICATED" | "FORBIDDEN" | "ACCOUNT_SECURITY"
  | "NOT_FOUND" | "FORM_CHANGED" | "ACTIVITY_FULL" | "BOOKING_CLOSED" | "CONFLICT"
  | "TOO_LARGE" | "FILE_TYPE" | "RATE_LIMIT" | "UNAVAILABLE";

export type ActivityOffer = {
  id: string; kind: "activity"; title: string; description: string; priceCents: number | null;
  bookingClosesAt: string; revision: number;
  /** 后台创建或编辑活动时维护的分类标签。旧接口缺省时按未设置处理。 */
  tags?: string[];
  /** 兼容旧客户端；活动分类使用 tags。 */
  topic: AssessmentTopic | null;
  activity: { id: string; targetStages: number[] | null; location: string; startsAt: string;
    durationMinutes: number | null; remaining: number | null };
};
export type ActivityRequest = {
  id: string; kind: "activity"; participantId: string; participantName: string; publicationId: string;
  activityId: string | null; title: string; priceCents: number | null;
  status: "pending" | "contacted" | "confirmed" | "declined" | "cancelled";
  createdAt: string; resolvedAt: string | null; reply: string;
};
export type ActivityRequestCommand = { action: "apply"; id: string; publicationId: string;
  kind: "activity"; revision: number; participantId: string } | { action: "cancel"; id: string };
export type ServiceContact = { stageNumber: number; facilitatorName: string; phone: string; qrCodeUrl: string };

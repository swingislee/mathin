// 跨 action 子域共享的入参 / 返回类型。纯类型模块（无运行时依赖），
// 客户端组件可以安全 import，不会把服务端代码拖进浏览器 bundle。

import type { AttendanceStatus } from "../learning";

export interface StudentSearchResult {
  id: string;
  name: string;
  grade: number | null;
  status: string;
}

export interface BuildClassSession {
  lectureId: string | null;
  no: number | null;
  name: string;
  scheduledAt: string;
  durationMin: number;
  closedDayReason?: string;
}

export interface BuildClassInput {
  name: string;
  courseId: string | null;
  capacity: number | null;
  roomId: string | null;
  primaryTeacherId: string;
  learningSupportId: string | null;
  schoolTermId: string;
  purpose: "production" | "test";
  offeringType: "long_term_formal" | "short_term_topic";
  activateNow: boolean;
  sessions: BuildClassSession[];
}

export interface AttendanceDrawerRow {
  studentId: string;
  studentName: string;
  status: AttendanceStatus;
  note: string;
  marked: boolean;
}

export interface SessionChangeOptions {
  students: Array<{ id: string; name: string }>;
  targets: Array<{ id: string; title: string; scheduledAt: string; classroomName: string }>;
}

export interface OrderItemInput {
  name: string;
  category: "course" | "material" | "other";
  unitPrice: number;
  qty: number;
  refundable: boolean;
}

export interface ConsumeRule {
  present: number;
  late: number;
  absent: number;
  leave: number;
}

export const FOLLOW_UP_KINDS = ["note", "call", "class", "visit"] as const;
export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number];

export interface CreateStudentInput {
  name: string;
  grade: number | null;
  phone: string;
  region?: string;
  source: string;
  parentName?: string;
  parentPhone?: string;
  remark: string;
}

export interface UpdateStudentInput {
  name: string;
  gender: string;
  birthday: string | null;
  phone: string;
  wechat: string;
  school: string;
  publicSchoolClass: string;
  grade: number | null;
  region: string;
  source: string;
  marketActivity: string;
  parentName: string;
  parentRelation: string;
  parentPhone: string;
  remark: string;
}

export interface DuplicateStudentRow {
  id: string;
  name: string;
  phone: string;
  status: string;
}

export interface ImportStudentRow {
  name: string;
  phone: string;
  grade: number | string | null;
  region: string;
  source: string;
  remark: string;
}

export interface ImportStudentsResult {
  inserted: number;
  dup: number;
  errors: Array<{ row: number; reason: string }>;
}

export const STUDENT_IMPORT_TEMPLATE_VERSION = "mathin-students-v1" as const;

export interface StudentImportBatchRow {
  row: number;
  status: "valid" | "duplicate" | "error" | "inserted";
  errors: string[];
  targetId: string | null;
}

export interface StudentImportBatchResult {
  batchId: string;
  status: "validated" | "completed";
  templateVersion: typeof STUDENT_IMPORT_TEMPLATE_VERSION;
  inputHash: string;
  total: number;
  valid: number;
  dup: number;
  errorCount: number;
  inserted: number;
  expiresAt: string;
  rows: StudentImportBatchRow[];
}

export interface StudentImportBatchSummary {
  batchId: string;
  status: "validated" | "completed";
  total: number;
  valid: number;
  duplicates: number;
  errors: number;
  inserted: number;
  createdAt: string;
  completedAt: string | null;
}

export interface PreviewStudentImportInput {
  templateVersion: typeof STUDENT_IMPORT_TEMPLATE_VERSION;
  idempotencyKey: string;
  rows: ImportStudentRow[];
}

export const MOFAXIAO_STUDENT_IMPORT_TEMPLATE_VERSION = "mofaxiao-students-v1" as const;

export interface MofaxiaoStudentImportRow {
  sourceRow: number;
  externalStudentId: string;
  name: string;
  phone: string;
  phoneMasked: boolean;
  phoneInvalid: boolean;
  gender: string;
  birthday: string | null;
  birthdayText: string;
  school: string;
  publicSchoolClass: string;
  grade: number | null;
  gradeText: string;
  gradeUnmapped: boolean;
  parentName: string;
  parentRelation: string;
  parentPhone: string;
  parentPhoneMasked: boolean;
  parentPhoneInvalid: boolean;
  remark: string;
  source: string;
  marketActivity: string;
  tags: string[];
}

export type MofaxiaoStudentImportMatchKind =
  | "new"
  | "external_id"
  | "student_phone"
  | "parent_phone_name"
  | "same_batch";

export interface MofaxiaoStudentImportBatchRow {
  row: number;
  sourceRow: number;
  sourceName: string;
  status: "valid" | "duplicate" | "error" | "inserted";
  errors: string[];
  targetId: string | null;
  matchKind: MofaxiaoStudentImportMatchKind;
}

export interface MofaxiaoStudentImportBatchResult {
  batchId: string;
  status: "validated" | "completed";
  templateVersion: typeof MOFAXIAO_STUDENT_IMPORT_TEMPLATE_VERSION;
  inputHash: string;
  fileName: string;
  fileHash: string;
  sheetName: string;
  batchLabel: string;
  total: number;
  valid: number;
  dup: number;
  errorCount: number;
  inserted: number;
  expiresAt: string;
  rows: MofaxiaoStudentImportBatchRow[];
}

export interface MofaxiaoStudentImportBatchSummary {
  batchId: string;
  status: "validated" | "completed";
  fileName: string;
  batchLabel: string;
  total: number;
  valid: number;
  duplicates: number;
  errors: number;
  inserted: number;
  createdAt: string;
  completedAt: string | null;
}

export interface PreviewMofaxiaoStudentImportInput {
  templateVersion: typeof MOFAXIAO_STUDENT_IMPORT_TEMPLATE_VERSION;
  idempotencyKey: string;
  fileName: string;
  fileHash: string;
  sheetName: string;
  batchLabel: string;
  rows: MofaxiaoStudentImportRow[];
}

export const MOFAXIAO_CLASS_IMPORT_TEMPLATE_VERSION = "mofaxiao-classes-v1" as const;

export interface ClassImportCourseOption {
  id: string;
  familySlug: string;
  title: string;
  productCode: string | null;
  catalogVersionTitle: string;
  catalogVersionCurrent: boolean;
  grade: number;
  season: number | null;
  classType: string;
}

export interface MofaxiaoClassImportRow {
  sourceRow: number;
  externalClassId: string;
  name: string;
  teachingMode: string;
  courseName: string;
  courseType: string;
  progressText: string;
  subject: string;
  grade: number | null;
  gradeText: string;
  gradeUnmapped: boolean;
  season: number | null;
  seasonText: string;
  classType: string;
  assessmentDifficulty: string;
  teacherName: string;
  campusName: string;
  roomName: string;
  feeText: string;
  currentStudentCount: number | null;
  enrolledCount: number | null;
  capacity: number | null;
  capacityInvalid: boolean;
  sourceStatus: string;
  startDate: string | null;
  startDateText: string;
  endDate: string | null;
  endDateText: string;
  sessionTime: string;
  purchasedText: string;
  courseId: string | null;
  importAsFreeClass: boolean;
  primaryTeacherId: string | null;
  roomId: string | null;
  schoolTermId: string | null;
}

export type MofaxiaoClassImportMatchKind = "new" | "source_id" | "existing_class" | "same_batch";

export interface MofaxiaoClassImportBatchRow {
  row: number;
  sourceRow: number;
  sourceClassId: string;
  sourceName: string;
  status: "valid" | "duplicate" | "error" | "inserted";
  errors: string[];
  targetId: string | null;
  matchKind: MofaxiaoClassImportMatchKind;
}

export interface MofaxiaoClassImportBatchResult {
  batchId: string;
  status: "validated" | "completed";
  templateVersion: typeof MOFAXIAO_CLASS_IMPORT_TEMPLATE_VERSION;
  inputHash: string;
  fileName: string;
  fileHash: string;
  sheetName: string;
  batchLabel: string;
  total: number;
  valid: number;
  dup: number;
  errorCount: number;
  inserted: number;
  expiresAt: string;
  rows: MofaxiaoClassImportBatchRow[];
}

export interface MofaxiaoClassImportBatchSummary {
  batchId: string;
  status: "validated" | "completed";
  fileName: string;
  batchLabel: string;
  total: number;
  valid: number;
  duplicates: number;
  errors: number;
  inserted: number;
  createdAt: string;
  completedAt: string | null;
}

export interface PreviewMofaxiaoClassImportInput {
  templateVersion: typeof MOFAXIAO_CLASS_IMPORT_TEMPLATE_VERSION;
  idempotencyKey: string;
  fileName: string;
  fileHash: string;
  sheetName: string;
  batchLabel: string;
  rows: MofaxiaoClassImportRow[];
}

export const XIAODITUI_IMPORT_TEMPLATE_VERSION = "xiaoditui-leads-v1" as const;

export interface XiaodituiLeadImportRow {
  sourceRow: number;
  childName: string;
  phone: string;
  grade: number | null;
  gradeText: string;
  interestText: string;
  interests: string[];
  wechatNickname: string;
  submittedAt: string | null;
  sourceDuplicate: boolean;
  acquisitionMethod: string;
  promoter: string;
  location: string;
  remark: string;
  orderNumber: string;
  paymentStatus: string;
  paymentAt: string | null;
}

export type LeadImportMatchKind =
  | "new"
  | "existing_seed"
  | "existing_student_hint"
  | "phone_name_conflict"
  | "source_marked_duplicate"
  | "same_batch_duplicate";

export type LeadImportDecision =
  | "auto_create"
  | "auto_link"
  | "pending"
  | "create_new"
  | "link_existing"
  | "skip";

export interface LeadImportBatchRow {
  row: number;
  sourceRow: number;
  sourceName: string;
  sourcePhone: string;
  status: "valid" | "duplicate" | "error" | "inserted";
  errors: string[];
  targetId: string | null;
  matchKind: LeadImportMatchKind;
  decision: LeadImportDecision;
  matchedLeadId: string | null;
  matchedLeadName: string | null;
  suggestedStudentId: string | null;
  suggestedStudentName: string | null;
}

export interface LeadImportBatchResult {
  batchId: string;
  status: "validated" | "completed";
  templateVersion: typeof XIAODITUI_IMPORT_TEMPLATE_VERSION;
  inputHash: string;
  fileName: string;
  fileHash: string;
  sheetName: string;
  batchLabel: string;
  total: number;
  valid: number;
  dup: number;
  errorCount: number;
  newCount: number;
  matchedCount: number;
  reviewCount: number;
  skippedCount: number;
  created: number;
  applied: number;
  expiresAt: string;
  rows: LeadImportBatchRow[];
}

export interface LeadImportBatchSummary {
  batchId: string;
  status: "validated" | "completed";
  fileName: string;
  batchLabel: string;
  total: number;
  duplicates: number;
  errors: number;
  created: number;
  reviewCount: number;
  createdAt: string;
  completedAt: string | null;
}

export interface PreviewLeadImportInput {
  templateVersion: typeof XIAODITUI_IMPORT_TEMPLATE_VERSION;
  idempotencyKey: string;
  fileName: string;
  fileBase64: string;
  sheetName: string;
  batchLabel: string;
  rows: XiaodituiLeadImportRow[];
}

export const STAFF_IMPORT_TEMPLATE_VERSION = "mathin-staff-v1" as const;

export interface ImportStaffRow {
  name: string;
  identifier: string;
  roles: string[];
  validDays: number;
}

export interface StaffImportBatchRow {
  row: number;
  status: "valid" | "duplicate" | "error" | "inserted";
  errors: string[];
  targetId: string | null;
}

export interface StaffImportInvitation {
  row: number;
  name: string;
  identifierType: "email" | "phone";
  identifier: string;
  roleKeys: string[];
  inviteCode: string;
  expiresAt: string;
}

export interface StaffImportBatchResult {
  batchId: string;
  status: "validated" | "completed";
  templateVersion: typeof STAFF_IMPORT_TEMPLATE_VERSION;
  inputHash: string;
  total: number;
  valid: number;
  dup: number;
  errorCount: number;
  issued: number;
  expiresAt: string;
  rows: StaffImportBatchRow[];
  codesAvailable: boolean;
  invitations: StaffImportInvitation[];
}

export interface StaffImportBatchSummary {
  batchId: string;
  status: "validated" | "completed";
  total: number;
  valid: number;
  duplicates: number;
  errors: number;
  issued: number;
  createdAt: string;
  completedAt: string | null;
}

export interface PreviewStaffImportInput {
  templateVersion: typeof STAFF_IMPORT_TEMPLATE_VERSION;
  idempotencyKey: string;
  rows: ImportStaffRow[];
}

export interface CourseWriteInput {
  title: string;
  productCode: string;
  grade: number;
  term: number;
  classType: string;
  status: "enabled" | "disabled";
}

export interface FoundProfile {
  userId: string;
  displayName: string;
  identity: "student" | "parent" | "staff" | "admin";
}

export interface StaffHandoverPreview {
  studentCount: number;
  futureOverrideCount: number;
  classroomCount: number;
}

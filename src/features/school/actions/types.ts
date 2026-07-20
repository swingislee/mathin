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
  lectureId: string;
  no: number;
  name: string;
  scheduledAt: string;
  durationMin: number;
}

export interface BuildClassInput {
  name: string;
  courseId: string | null;
  capacity: number | null;
  room: string;
  primaryTeacherId: string;
  learningSupportId: string | null;
  schoolTermId: string;
  purpose: "production" | "test";
  activateNow: boolean;
  sessions: BuildClassSession[];
}

export interface AttendanceDrawerRow {
  studentId: string;
  studentName: string;
  status: AttendanceStatus;
  note: string;
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
  grade: number | null;
  region: string;
  source: string;
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

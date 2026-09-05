import { z } from "zod";

const nullableId = z.uuid().nullable();
export const CONTACT_ROUTES = ["continue_follow_up", "await_product", "closed", "enrollment_pending"] as const;
export const CONTACT_CHANNELS = ["phone", "wechat", "in_person", "other"] as const;
export type EnrollmentSourceRef = { registrationId: string | null; invitationId: string | null };

export const activityEnrollmentContextSchema = z.object({
  registrationId: z.uuid(), studentId: nullableId, leadId: nullableId,
  name: z.string(), phone: z.string(), grade: z.number().nullable(), gradeText: z.string(),
  ownerId: nullableId, leadStatus: z.string().nullable(),
  activityId: z.uuid(), activityTitle: z.string(), activityAt: z.string(), eligible: z.boolean(),
  recommendation: z.string(), assessmentBand: z.string().nullable(), route: z.enum(CONTACT_ROUTES).nullable(),
  routeNote: z.string(), enrollmentId: nullableId, courseTitle: z.string().nullable(),
  termName: z.string().nullable(), classroomName: z.string().nullable(), termId: nullableId,
  canContact: z.boolean(), canEnroll: z.boolean(),
  contacts: z.array(z.object({
    id: z.uuid(), channel: z.enum(CONTACT_CHANNELS), outcome: z.enum(["connected", "unreachable"]),
    route: z.enum(CONTACT_ROUTES), note: z.string(), nextContactAt: z.string().nullable(),
    occurredAt: z.string(), recordedByName: z.string(),
  })),
});
export type ActivityEnrollmentContext = z.infer<typeof activityEnrollmentContextSchema>;

export const enrollmentWorkflowOptionsSchema = z.object({
  courses: z.array(z.object({ id: z.uuid(), title: z.string(), productCode: z.string().nullable(), grade: z.number(), classType: z.string() })),
  terms: z.array(z.object({ id: z.uuid(), name: z.string(), isCurrent: z.boolean(), startsOn: z.string().nullable(), endsOn: z.string().nullable() })),
  classrooms: z.array(z.object({
    id: z.uuid(), name: z.string(), courseId: z.uuid(), termId: z.uuid(), capacity: z.number().int().nonnegative().nullable(),
    activeCount: z.number().int().nonnegative(), operationalStatus: z.enum(["planning", "active"]), teacherNames: z.string(),
    sessions: z.array(z.object({ at: z.string(), duration: z.number() })),
  })),
});
export type EnrollmentWorkflowOptions = z.infer<typeof enrollmentWorkflowOptionsSchema>;
export type PlacementClassroom = EnrollmentWorkflowOptions["classrooms"][number];

export const placementMemberSchema = z.object({
  membershipId: z.uuid(), studentId: z.uuid(), name: z.string(), phone: z.string(), classroomId: z.uuid(),
  enrollmentId: nullableId, note: z.string(), recommendation: z.string(),
});
export type PlacementMember = z.infer<typeof placementMemberSchema>;
export const enrollmentSchema = z.object({
  id: z.uuid(),
  opportunityId: z.uuid(),
  studentId: z.uuid(),
  studentName: z.string(),
  studentPhone: z.string(),
  courseId: z.uuid(),
  courseTitle: z.string(),
  termId: z.uuid(),
  termName: z.string(),
  status: z.enum(["active", "cancelled"]),
  note: z.string(),
  confirmedAt: z.string(),
  confirmedByName: z.string(),
  cancelledAt: z.string().nullable(),
  cancelledByName: z.string().nullable(),
  assignmentId: nullableId,
  classroomId: nullableId,
  classroomName: z.string().nullable(),
  membershipId: nullableId,
  assignedAt: z.string().nullable(),
  claimableClassroomIds: z.array(z.uuid()),
  updatedAt: z.string(),
});
export type CourseEnrollmentRow = z.infer<typeof enrollmentSchema>;

export interface EnrollmentPlacementBoard {
  options: EnrollmentWorkflowOptions;
  enrollments: CourseEnrollmentRow[];
  members: PlacementMember[];
}
export interface PlacementStudent {
  key: string;
  enrollmentId: string | null;
  membershipId: string | null;
  studentId: string;
  name: string;
  phone: string;
  grade: number;
  courseId: string;
  courseTitle: string;
  termId: string;
  classroomId: string | null;
  note: string;
  recommendation: string;
}

/** 花名册已经占用名额；未关联的报名不在待分班首行重复显示。 */
export function placementStudents(board: EnrollmentPlacementBoard): PlacementStudent[] {
  const courses = new Map(board.options.courses.map((course) => [course.id, course]));
  const classrooms = new Map(board.options.classrooms.map((classroom) => [classroom.id, classroom]));
  const linked = new Set(board.members.map((member) => member.enrollmentId).filter(Boolean));
  const members: PlacementStudent[] = board.members.flatMap((member) => {
    const classroom = classrooms.get(member.classroomId);
    if (!classroom) return [];
    const course = courses.get(classroom.courseId);
    return [{
      ...member, key: member.membershipId, courseId: classroom.courseId, courseTitle: course?.title ?? "",
      termId: classroom.termId, grade: course?.grade ?? 0,
    }];
  });
  return [...members, ...board.enrollments.filter((row) => row.status === "active" && !linked.has(row.id)).map((row) => ({
    key: row.id, enrollmentId: row.id, membershipId: row.membershipId, studentId: row.studentId,
    name: row.studentName, phone: row.studentPhone, grade: courses.get(row.courseId)?.grade ?? 0,
    courseId: row.courseId, courseTitle: row.courseTitle, termId: row.termId, classroomId: row.classroomId,
    note: row.note, recommendation: "",
  }))];
}

export function placementDestinationError(student: PlacementStudent, classroom: PlacementClassroom | null, members: readonly PlacementStudent[]): string | null {
  if (!classroom) return null;
  if (classroom.id === student.classroomId) return null;
  if (classroom.termId !== student.termId || classroom.courseId !== student.courseId) return "CLASS_TARGET_MISMATCH";
  const alreadyPresent = members.some((member) => member.classroomId === classroom.id && member.studentId === student.studentId);
  if (!alreadyPresent && classroom.capacity !== null && classroom.activeCount >= classroom.capacity) return "CLASS_FULL";
  return null;
}

export function followupState(context: ActivityEnrollmentContext): "enrolled" | "closed" | "waiting" | "unreachable" | "contact" {
  if (context.enrollmentId) return "enrolled";
  if (context.route === "closed") return "closed";
  if (context.route === "await_product") return "waiting";
  if (context.contacts[0]?.outcome === "unreachable") return "unreachable";
  return "contact";
}

export function classScheduleLabel(classroom: PlacementClassroom, locale: string): string {
  const dateTime = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" });
  return classroom.sessions.slice(0, 2).map((session) => dateTime.format(new Date(session.at))).join(" / ");
}

export function enrollmentErrorKey(code: string) {
  if (["FORBIDDEN", "FORBIDDEN_SCOPE", "UNAUTHENTICATED"].includes(code)) return "errorPermission";
  if (code === "CLASS_FULL") return "errorFull";
  if (code === "CLASS_TARGET_MISMATCH") return "errorTarget";
  if (code === "IDENTITY_NOT_CONFIRMED") return "identityRequired";
  if (code === "PARTICIPATION_NOT_COMPLETED") return "notCompleted";
  if (["PLACEMENT_CHANGED", "ENROLLMENT_ALREADY_ASSIGNED", "CLASS_MEMBERSHIP_NOT_ACTIVE", "MEMBERSHIP_ALREADY_LINKED"].includes(code)) return "errorChanged";
  if (["ENROLLMENT_CANCELLED", "ENROLLMENT_NOT_ACTIVE"].includes(code)) return "errorCancelled";
  return "errorSave";
}

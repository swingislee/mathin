import type { ActivityEnrollmentContext, EnrollmentPlacementBoard, PlacementClassroom, PlacementStudent } from "./enrollment-workflow-contract";
import type { RenewalHealthSignal } from "./renewal-health-contract";
export type { EnrollmentPlacementBoard, PlacementClassroom, PlacementStudent } from "./enrollment-workflow-contract";

/** 页面反馈使用服务端下发的关系；数据库在写入时再次核对实际两端。 */
export function canMovePlacement(access: EnrollmentPlacementBoard['access'], from: string | null, to: string | null): boolean {
  if (!access) return true;
  return Boolean((from && access.teacherClassroomIds.includes(from)) || (to && access.teacherClassroomIds.includes(to))
    || (access.canManageEnrollments && (!from || access.managedClassroomIds.includes(from)) && (!to || access.managedClassroomIds.includes(to))));
}


/** 花名册已经占用名额；未关联的报名不在待分班首行重复显示。 */
export function placementStudents(board: EnrollmentPlacementBoard): PlacementStudent[] {
  const courses = new Map(board.options.courses.map((course) => [course.id, course]));
  const classrooms = new Map(board.options.classrooms.map((classroom) => [classroom.id, classroom]));
  const linked = new Set(board.members.map((member) => member.enrollmentId).filter(Boolean));
  const members: PlacementStudent[] = board.members.flatMap((member) => {
    const classroom = classrooms.get(member.classroomId);
    if (!classroom) return [];
    const course = courses.get(classroom.courseId ?? "");
    return [{
      ...member, key: member.membershipId, courseId: classroom.courseId ?? "", courseTitle: course?.title ?? "",
      seat: member.seat ?? null, status: member.status ?? "active",
      termId: classroom.termId, grade: classroom.grade ?? course?.grade ?? 0,
    }];
  });
  return [...members, ...board.enrollments.filter((row) => !linked.has(row.id)).map((row) => ({
    key: row.id, enrollmentId: row.id, membershipId: row.membershipId, studentId: row.studentId,
    name: row.studentName, phone: row.studentPhone, grade: courses.get(row.courseId)?.grade ?? 0,
    courseId: row.courseId, courseTitle: row.courseTitle, termId: row.termId, classroomId: row.classroomId,
    note: row.note, recommendation: "",
    seat: null, status: row.status === "cancelled" ? "withdrawn" as const : "active" as const,
    canViewDetails: row.canViewDetails,
  }))];
}


export function placementDestinationError(student: PlacementStudent, classroom: PlacementClassroom | null, members: readonly PlacementStudent[], allowMismatch = false): string | null {
  if (student.status === "withdrawn") return "ENROLLMENT_CANCELLED";
  if (!student.courseId || (classroom && !classroom.courseId)) return "CLASS_TARGET_MISMATCH";
  if (!classroom) return null;
  if (classroom.id === student.classroomId) return null;
  if (!allowMismatch && (classroom.termId !== student.termId || classroom.courseId !== student.courseId)) return "CLASS_TARGET_MISMATCH";
  const alreadyPresent = members.some((member) => member.classroomId === classroom.id && member.studentId === student.studentId && member.status !== "withdrawn");
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


/** 颜色汇总已观察的事实，缺测保持中性；不把颜色解释为续报概率。 */
export function placementHealth(signals: readonly RenewalHealthSignal[] = []) {
  const known = signals.filter((signal) => signal.level === "observed" || signal.level === "attention");
  if (known.length < 2) return { tone: "neutral" as const, balance: 0, background: "var(--card)" };
  const attention = known.filter((signal) => signal.level === "attention").length;
  const balance = (known.length - attention * 2) / known.length;
  if (balance === 0) return { tone: "neutral" as const, balance, background: "var(--card)" };
  const strength = Math.round(10 + Math.abs(balance) * 22);
  return { tone: balance < 0 ? "low" as const : "high" as const, balance,
    background: balance < 0 ? `color-mix(in srgb, var(--card) ${100 - strength}%, var(--rose))` : "var(--card)" };
}


/** 危险提示优先；普通健康保持白底，已续报单独使用浅绿。 */
export function placementStudentBackground(health: ReturnType<typeof placementHealth> | null, renewed: boolean) {
  if (health?.tone === "low") return health.background;
  return renewed ? "color-mix(in srgb, var(--leaf) 24%, var(--card))" : "var(--card)";
}


export function classWeeklyScheduleLabel(classroom: PlacementClassroom, locale: string) {
  const dayTime = new Intl.DateTimeFormat(locale, { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" });
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" });
  return [...new Set(classroom.sessions.map((session) => `${dayTime.format(new Date(session.at))}–${time.format(new Date(Date.parse(session.at) + session.duration * 60000))}`))].join(" / ") || classroom.source?.scheduleLabel || "";
}


export function classScheduleLabel(classroom: PlacementClassroom, locale: string): string {
  const dateTime = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" });
  return classroom.sessions.slice(0, 2).map((session) => dateTime.format(new Date(session.at))).join(" / ");
}


export function enrollmentErrorKey(code: string) {
  if (["FORBIDDEN", "FORBIDDEN_SCOPE", "UNAUTHENTICATED"].includes(code)) return "errorPermission";
  if (code === "CLASS_FULL") return "errorFull";
  if (code === "SEAT_OCCUPIED") return "errorSeatOccupied";
  if (code === "INVALID_SEAT") return "errorSeat";
  if (code === "CLASS_TARGET_MISMATCH") return "errorTarget";
  if (code === "IDENTITY_NOT_CONFIRMED") return "identityRequired";
  if (code === "PARTICIPATION_NOT_COMPLETED") return "notCompleted";
  if (["PLACEMENT_CHANGED", "ENROLLMENT_ALREADY_ASSIGNED", "CLASS_MEMBERSHIP_NOT_ACTIVE", "MEMBERSHIP_ALREADY_LINKED"].includes(code)) return "errorChanged";
  if (["ENROLLMENT_CANCELLED", "ENROLLMENT_NOT_ACTIVE"].includes(code)) return "errorCancelled";
  return "errorSave";
}

export function placementChangeError(code:string,en:boolean){
  const errors:Record<string,[string,string]>={
    PLACEMENT_CHANGED:['分班或讲次安排已有变化，请重新打开确认。','Placement or sessions changed. Reopen to review.'],
    SESSION_LOCKED:['该讲次已开课、已有考勤或名单已锁定。','This session has started, has attendance, or its roster is locked.'],
    SOURCE_SESSION_MISSING:['原班还没有对应讲次，请先安排原班课次。','Schedule the matching lesson in the original class first.'],
    SOURCE_SESSION_AMBIGUOUS:['原班有多个相同讲次，请先核对排课。','The original class has multiple matching sessions. Review its schedule.'],
    SESSION_TRANSFER_EXISTS:['该讲次已有临时调班安排。','This lesson already has a temporary transfer.'],
    TEMPORARY_SEAT_RESERVED:['该座位已有临时调班预约，请选择其他座位。','This seat has a temporary reservation. Choose another seat.'],
    SEAT_OCCUPIED:['目标座位已被占用，请重新选择。','The target seat is occupied. Choose another seat.'],
    CLASS_FULL:['目标班级该讲次已满。','The target session is full.'],
    FORBIDDEN_SCOPE:['当前账号无法调整该班级。','You cannot manage this class.'],
    FORBIDDEN:['当前账号没有分班权限。','Enrollment management permission is required.'],
    CLASS_TARGET_MISMATCH:['课程或学期与目标班不匹配，请核对并确认插班。','Course or term differs from the target class. Review and confirm the placement.'],
  };
  return errors[code]?.[en?1:0]??(en?'Unable to save. Refresh and try again.':'保存未完成，请刷新后重试。');
}

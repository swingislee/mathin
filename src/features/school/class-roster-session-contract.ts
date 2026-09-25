import { z } from "zod";
import type { ReviewRecord } from "./review-actions";
import type { SessionStudentPostworkRow } from "./SessionStudentPostworkTable";
import type { ClassroomWorkSession } from "./classroom-workbench-contract";
import { teachingRecordsSchema, type TeachingRecords } from "./teaching-workbench/teaching-records-contract";
import { teachingObservationSchema } from "./teaching-workbench/teaching-learning-summary";

export type ClassRosterSession = ClassroomWorkSession & { attendanceCount: number; reviewCount: number };
export const classSessionDetailSchema = z.union([z.object({
  stage: z.literal("pre"),
  canPrepare: z.boolean(), canEnterLive: z.boolean(), canMarkAttendance: z.boolean(),
}), z.object({
  records: teachingRecordsSchema,
  canWriteReview: z.boolean(),
  resultStatus: z.enum(["draft", "review", "published", "withdrawn", "revised"]),
})]);
export type ClassSessionDetail = z.infer<typeof classSessionDetailSchema>;
export function hasClassSessionStarted(session: Pick<ClassRosterSession, "startedAt" | "endedAt">) {
  return Boolean(session.startedAt || session.endedAt);
}
export const CLASS_SESSION_OBSERVATION_BATCH_SIZE = 40;
export const classSessionObservationsSchema = z.array(z.object({ sessionId: z.string(), observations: teachingObservationSchema.nullable() }));

export function orderedClassSessions(sessions: readonly ClassRosterSession[], classroomId: string) {
  return sessions.filter(session => session.classroomId === classroomId)
    .sort((a, b) => (a.scheduledAt ?? "9999").localeCompare(b.scheduledAt ?? "9999") || a.id.localeCompare(b.id));
}

/** 只使用所选课次返回的名单，冻结名单与临时调班由原课次 RPC 负责。 */
export function classSessionStudentWork(data: TeachingRecords): { rows: SessionStudentPostworkRow[]; reviews: ReviewRecord[] } {
  const attendance = new Map(data.attendance.map(row => [row.studentId, row]));
  const reviews = new Map(data.reviews.map(row => [row.studentId, row]));
  const results = new Map(data.results.map(row => [`${row.studentId}:${row.checkId}`, row.status]));
  return {
    rows: data.students.map(student => ({ studentId: student.id, displayName: student.name,
      attendanceStatus: attendance.get(student.id)?.status ?? null, attendanceNote: attendance.get(student.id)?.note, stars: null,
      reviewSource: reviews.has(student.id) ? { author: reviews.get(student.id)!.author, at: reviews.get(student.id)!.updatedAt } : undefined,
      checks: data.checks.map(check => ({ ...check, status: results.get(`${student.id}:${check.id}`) ?? "unchecked" })),
    })),
    reviews: data.students.map(student => {
      const review = reviews.get(student.id);
      return { studentId: student.id, studentName: student.name, comment: review?.comment ?? "",
        entryScore: review?.entryScore ?? null, exitScore: review?.exitScore ?? null,
        focus: review?.focus ?? null, participation: review?.participation ?? null, mastery: review?.mastery ?? null };
    }),
  };
}

export function classSessionMessages(locale: string) {
  return locale.startsWith("en") ? {
    session: "Lesson", noSessions: "No scheduled lessons",
    open: "View / record", attendance: "Attendance", reviews: "Reviews", noDate: "Unscheduled", untitled: "Untitled lesson",
    loading: "Loading lesson…", failed: "Lesson could not be loaded.", retry: "Retry", draft: "Entries are still syncing. Resolve any row errors before switching lessons.",
    workspace: "Lesson workspace", back: "Back to classes", preparation: "Before class", prepare: "Prepare lesson", enter: "Enter classroom", viewPreparation: "View lesson preparation",
    noAccess: "No accessible lesson is available for this link.",
    observationsLoading: "Loading responses…", observationsFailed: "Responses unavailable",
  } : {
    session: "课次", noSessions: "尚未安排课次",
    open: "查看 / 登记", attendance: "考勤", reviews: "课评", noDate: "待排时间", untitled: "未命名课次",
    loading: "正在读取课次…", failed: "课次读取失败。", retry: "重试", draft: "记录正在同步，请处理行内提示后再切换课次。",
    workspace: "课次工作区", back: "返回班级", preparation: "课前准备", prepare: "备课", enter: "进入课堂", viewPreparation: "查看备课",
    noAccess: "此链接暂无可查看的课次。",
    observationsLoading: "正在读取答题记录…", observationsFailed: "答题记录未读到",
  };
}

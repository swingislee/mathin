import { z } from "zod";
import type { ReviewRecord } from "./review-actions";
import type { SessionStudentPostworkRow } from "./SessionStudentPostworkTable";
import type { ClassroomWorkSession } from "./classroom-workbench-contract";
import { calendarDayKey } from "./schedule";
import { teachingRecordsSchema, type TeachingRecords } from "./teaching-workbench/teaching-records-contract";

export type ClassRosterSession = ClassroomWorkSession & { attendanceCount: number; reviewCount: number };
export const classSessionDetailSchema = z.object({
  records: teachingRecordsSchema,
  canWriteReview: z.boolean(),
  resultStatus: z.enum(["draft", "review", "published", "withdrawn", "revised"]),
});
export type ClassSessionDetail = z.infer<typeof classSessionDetailSchema>;

export function orderedClassSessions(sessions: readonly ClassRosterSession[], classroomId: string) {
  return sessions.filter(session => session.classroomId === classroomId)
    .sort((a, b) => (a.scheduledAt ?? "9999").localeCompare(b.scheduledAt ?? "9999") || a.id.localeCompare(b.id));
}

/** 优先明确定位、正在上课、今天、最近已到时间的课次；尚未开课时选下一课。 */
export function defaultClassSession(sessions: readonly ClassRosterSession[], now: number, timeZone: string, requestedId?: string) {
  const today = calendarDayKey(new Date(now), timeZone);
  return sessions.find(session => session.id === requestedId)
    ?? sessions.find(session => session.startedAt && !session.endedAt)
    ?? sessions.find(session => session.scheduledAt && calendarDayKey(new Date(session.scheduledAt), timeZone) === today)
    ?? sessions.filter(session => session.scheduledAt && Date.parse(session.scheduledAt) <= now).at(-1)
    ?? sessions[0];
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
    session: "Lesson", previous: "Previous lesson", next: "Next lesson", choose: "Choose lesson", noSessions: "No scheduled lessons",
    open: "View / record", close: "Collapse", attendance: "Attendance", reviews: "Reviews", noDate: "Unscheduled", untitled: "Untitled lesson",
    loading: "Loading lesson records…", failed: "Lesson records could not be loaded.", retry: "Retry", draft: "Save the current entries before switching lessons or changing the list.",
    roster: "Students below belong to the selected lesson.", workspace: "Open lesson workspace", back: "Back to classes",
    noAccess: "No accessible lesson is available for this link.",
  } : {
    session: "课次", previous: "上一课", next: "下一课", choose: "选择课次", noSessions: "尚未安排课次",
    open: "查看 / 登记", close: "收起", attendance: "考勤", reviews: "课评", noDate: "待排时间", untitled: "未命名课次",
    loading: "正在读取本课记录…", failed: "本课记录读取失败。", retry: "重试", draft: "请先保存当前登记，再切换课次或调整名单。",
    roster: "下方按所选课次的实际学生名单登记。", workspace: "进入课次工作区", back: "返回班级",
    noAccess: "此链接暂无可查看的课次。",
  };
}

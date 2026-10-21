import { z } from "zod";
import type { ReviewRecord } from "./review-actions";
import type { SessionStudentPostworkRow } from "./SessionStudentPostworkTable";
import type { ClassroomWorkSession } from "./classroom-workbench-contract";
import { teachingRecordsSchema, type TeachingRecords } from "./teaching-workbench/teaching-records-contract";
import { teachingObservationSchema } from "./teaching-workbench/teaching-learning-summary";
import type { SessionCapabilities } from "./teaching-operations/types";
import type { LearningResultStatus } from "./learning-results";

export type ClassRosterSession = ClassroomWorkSession & {
  attendanceCount: number;
  reviewCount: number;
  reviewStatus?: LearningResultStatus;
  durationMin?: number | null;
  capabilities?: Pick<SessionCapabilities, "canOpenManagement" | "canPrepare" | "canEnterLive">
    & Partial<Pick<SessionCapabilities, "canMarkAttendance" | "canWriteReview">> & { canRehearse?: boolean };
};
export const classSessionDetailSchema = z.union([z.object({
  stage: z.literal("pre"),
  scheduledAt: z.string().nullable(), durationMin: z.number().nullable(),
  canPrepare: z.boolean(), canEnterLive: z.boolean(), canMarkAttendance: z.boolean(),
}), z.object({
  records: teachingRecordsSchema,
  canEnterLive: z.boolean().optional(),
  canWriteReview: z.boolean(),
  resultStatus: z.enum(["draft", "review", "published", "withdrawn", "revised"]),
})]);
export type ClassSessionDetail = z.infer<typeof classSessionDetailSchema>;
export const classSessionObservationsSchema = z.array(z.object({ sessionId: z.string(), observations: teachingObservationSchema.nullable() }));

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

export { hasClassSessionStarted, CLASS_SESSION_OBSERVATION_BATCH_SIZE, orderedClassSessions, classSessionMessages } from "./class-roster-session-presentation";

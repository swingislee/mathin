import { z } from "zod";
import { LEARNING_CHECK_STATUSES } from "./session-learning-contract";

export const assignmentQuestionResultSchema = z.object({
  questionId: z.string().uuid(), studentId: z.string().uuid(), status: z.enum(LEARNING_CHECK_STATUSES),
  note: z.string(), version: z.number().int().positive(), markedAt: z.string(), author: z.string().nullable(),
});
export const assignmentQuestionWorkbookSchema = z.object({
  assignment: z.object({ id: z.string().uuid(), title: z.string(), classroomName: z.string(), sessionId: z.string().uuid().nullable() }),
  canWrite: z.boolean(), questions: z.array(z.object({ id: z.string().uuid(), title: z.string(), position: z.number().int() })),
  students: z.array(z.object({ id: z.string().uuid(), name: z.string() })), results: z.array(assignmentQuestionResultSchema),
});
export type AssignmentQuestionWorkbook = z.infer<typeof assignmentQuestionWorkbookSchema>;
export type AssignmentQuestionResult = z.infer<typeof assignmentQuestionResultSchema>;
export type AssignmentQuestionChange = Pick<AssignmentQuestionResult, "studentId" | "questionId" | "status" | "note"> & { expectedVersion: number };
export const assignmentQuestionKey = (studentId: string, questionId: string) => `${studentId}:${questionId}`;

export function mergeAssignmentQuestionResults(current: AssignmentQuestionResult[], saved: AssignmentQuestionResult[]) {
  const rows = new Map(current.map(row => [assignmentQuestionKey(row.studentId, row.questionId), row]));
  for (const row of saved) rows.set(assignmentQuestionKey(row.studentId, row.questionId), row);
  return [...rows.values()];
}

/** 撤销使用保存后版本，遇到他人已修改时由数据库拒绝覆盖。 */
export function assignmentQuestionUndo(previous: AssignmentQuestionResult[], saved: AssignmentQuestionResult[]): AssignmentQuestionChange[] {
  const before = new Map(previous.map(row => [assignmentQuestionKey(row.studentId, row.questionId), row]));
  return saved.map(row => {
    const old = before.get(assignmentQuestionKey(row.studentId, row.questionId));
    return { questionId: row.questionId, studentId: row.studentId, expectedVersion: row.version, status: old?.status ?? "unchecked", note: old?.note ?? "" };
  });
}

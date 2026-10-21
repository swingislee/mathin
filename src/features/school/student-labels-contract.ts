import { z } from "zod";
import { databaseUuid } from "@/lib/database-uuid";
import { STUDENT_LABELS } from "./student-labels-presentation";
export const studentLabelSchema = z.enum(STUDENT_LABELS);
export type StudentLabel = z.infer<typeof studentLabelSchema>;

export const studentLabelStateSchema = z.object({
  enrollmentId: databaseUuid,
  label: studentLabelSchema.nullable(),
  canEdit: z.boolean(),
});
export type StudentLabelState = z.infer<typeof studentLabelStateSchema>;
export type StudentLabelStates = Record<string, StudentLabelState>;

export const setStudentLabelSchema = z.object({
  enrollmentId: databaseUuid,
  label: studentLabelSchema.nullable(),
});
export type SetStudentLabelInput = z.infer<typeof setStudentLabelSchema>;

/** Scoped types for the additive label RPCs; NULL explicitly clears a label. */
export interface StudentLabelsClient {
  rpc(name: "get_class_student_labels", args: { p_classroom_ids: string[] }): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  rpc(name: "set_class_student_label", args: { p_enrollment_id: string; p_label: StudentLabel | null }): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export { STUDENT_LABELS, studentLabelColors, studentLabelMessages } from "./student-labels-presentation";

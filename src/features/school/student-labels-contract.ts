import { z } from "zod";
import { databaseUuid } from "@/lib/database-uuid";
import { LEARNING_CHECK_STATUS_STYLE } from "./session-learning-visual";

export const STUDENT_LABELS = ["A", "B", "C", "D"] as const;
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

export const studentLabelColors: Record<StudentLabel, string> = {
  A: LEARNING_CHECK_STATUS_STYLE.independent.active,
  B: LEARNING_CHECK_STATUS_STYLE.prompted.active,
  C: LEARNING_CHECK_STATUS_STYLE.imitated.active,
  D: LEARNING_CHECK_STATUS_STYLE.incomplete.active,
};

export function studentLabelMessages(locale: string) {
  const en = locale.startsWith("en");
  return {
    title: en ? "Student label" : "学生标签",
    edit: (name: string, label: StudentLabel | null) => en
      ? `${name} · ${label ? `Label ${label}` : "No label"} · Set label`
      : `${name} · ${label ? `${label} 标签` : "未标记"} · 设置标签`,
    read: (name: string, label: StudentLabel) => en ? `${name} · Label ${label}` : `${name} · ${label} 标签`,
    clear: en ? "Clear label" : "清除标签",
    details: en ? "View student" : "查看学生",
    entryHint: en ? "Click the name for student details · Click the color dot to enter labels" : "单击姓名查看学情 360 · 点击颜色灯录入标签",
    keyboardHint: en
      ? "A–D / 1–4: save and next · ← →: student · ↑ ↓: row · Delete: clear · Esc: exit"
      : "A–D / 1–4：保存并下一位 · ← →：学生 · ↑ ↓：上下行 · Delete：清除 · Esc：退出",
    saving: en ? "Saving…" : "保存中…",
    saved: en ? "Label saved" : "标签已保存",
    error: en ? "Could not save. Please try again." : "保存失败，请重试。",
    forbidden: en ? "Only this student's current class teachers can change the label." : "仅当前班级的任课老师可以修改该学生标签。",
    changed: en ? "The class or enrollment changed. Refresh and try again." : "班级或在班状态已变化，请刷新后重试。",
  };
}

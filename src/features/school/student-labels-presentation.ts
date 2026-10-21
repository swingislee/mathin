import { LEARNING_CHECK_STATUS_STYLE } from "./session-learning-visual";
import type { StudentLabel } from "./student-labels-contract";
export type { StudentLabel, StudentLabelState } from "./student-labels-contract";

export const STUDENT_LABELS = ["A", "B", "C", "D"] as const;


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

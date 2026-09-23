/** 五个互斥当前阶段；细分状态和来源视图分别表达。 */
export const STUDENT_LIFECYCLE_STAGES = [
  "awaiting_first_contact",
  "awaiting_assessment",
  "awaiting_enrollment",
  "awaiting_renewal",
  "former_student",
] as const;

export type StudentLifecycleStage = (typeof STUDENT_LIFECYCLE_STAGES)[number];

/** 表名表示推进过程；圆圈保持原有的待首联、待测评、待报名、待续费阶段含义。 */
export const STUDENT_LIFECYCLE_ROADMAP = [
  { table: "leads", stage: "awaiting_first_contact" },
  { table: "communication", stage: "awaiting_assessment" },
  { table: "assessments", stage: "awaiting_enrollment" },
  { table: "enrollments", stage: "awaiting_renewal" },
  { table: "renewals", stage: null },
] as const satisfies readonly { table: string; stage: StudentLifecycleStage | null }[];

export function parseStudentLifecycleStage(value: unknown): StudentLifecycleStage {
  if (typeof value === "string" && STUDENT_LIFECYCLE_STAGES.includes(value as StudentLifecycleStage)) {
    return value as StudentLifecycleStage;
  }
  throw new Error("INVALID_STUDENT_LIFECYCLE");
}

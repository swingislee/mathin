/** 四个业务里程碑标签；表内临时状态与当前/历史工作范围分别表达。 */
export const STUDENT_LIFECYCLE_STAGES = [
  "awaiting_first_contact",
  "awaiting_assessment",
  "awaiting_enrollment",
  "awaiting_renewal",
] as const;

export type StudentLifecycleStage = (typeof STUDENT_LIFECYCLE_STAGES)[number];

export function parseStudentLifecycleStage(value: unknown): StudentLifecycleStage {
  if (typeof value === "string" && STUDENT_LIFECYCLE_STAGES.includes(value as StudentLifecycleStage)) {
    return value as StudentLifecycleStage;
  }
  throw new Error("INVALID_STUDENT_LIFECYCLE");
}

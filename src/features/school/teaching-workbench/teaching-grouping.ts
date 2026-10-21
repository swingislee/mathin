export type TeachingGrouping = "grade" | "teacher";
export const teachingGrouping = (value: unknown): TeachingGrouping => value === "teacher" ? "teacher" : "grade";

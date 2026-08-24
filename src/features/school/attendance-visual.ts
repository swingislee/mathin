import type { AttendanceStatus } from "./learning";

/** Shared attendance colors for the full attendance form and the compact lamp in learning checks. */
export const ATTENDANCE_STATUS_TONE: Record<AttendanceStatus, string> = {
  present: "border-leaf/60 bg-leaf/15 text-leaf-deep",
  absent: "border-rose/60 bg-rose/10 text-rose",
  late: "border-amber-400/60 bg-amber-100 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100",
  leave: "border-sky-400/60 bg-sky-100 text-sky-950 dark:bg-sky-950/40 dark:text-sky-100",
};

export const ATTENDANCE_STATUS_LIGHT: Record<AttendanceStatus, string> = {
  present: "fill-leaf text-leaf-deep",
  absent: "fill-rose/75 text-rose",
  late: "fill-amber-300 text-amber-600 dark:fill-amber-500 dark:text-amber-200",
  leave: "fill-sky-300 text-sky-600 dark:fill-sky-500 dark:text-sky-200",
};

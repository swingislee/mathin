import type { AttendanceStatus } from "./learning";

/** Shared attendance colors for the full attendance form and the compact lamp in learning checks. */
export const ATTENDANCE_STATUS_TONE: Record<AttendanceStatus, string> = {
  present: "border-leaf/60 bg-leaf/15 text-leaf-deep",
  absent: "border-rose/60 bg-rose/10 text-rose",
  late: "border-amber-400/60 bg-amber-100 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100",
  leave: "border-sky-400/60 bg-sky-100 text-sky-950 dark:bg-sky-950/40 dark:text-sky-100",
};

export const ATTENDANCE_STATUS_LED: Record<AttendanceStatus, string> = {
  present: "bg-leaf ring-leaf/20",
  absent: "bg-rose ring-rose/20",
  late: "bg-amber-400 ring-amber-400/20",
  leave: "bg-sky-400 ring-sky-400/20",
};

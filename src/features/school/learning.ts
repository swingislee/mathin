// 学情聚合纯函数（10-§6：员工/学生/家长复用同一套计算，只是渲染只读/可写不同）。

export const ATTENDANCE_STATUSES = ["present", "absent", "late", "leave"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export interface AttendanceSummary {
  present: number;
  absent: number;
  late: number;
  leave: number;
  total: number;
  rate: number; // present / total，total=0 时为 0
}

export function summarizeAttendance(statuses: AttendanceStatus[]): AttendanceSummary {
  const present = statuses.filter((status) => status === "present").length;
  const absent = statuses.filter((status) => status === "absent").length;
  const late = statuses.filter((status) => status === "late").length;
  const leave = statuses.filter((status) => status === "leave").length;
  const total = statuses.length;
  return { present, absent, late, leave, total, rate: total > 0 ? present / total : 0 };
}

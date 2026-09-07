export interface MonthlyTargetCell {
  teacher: string;
  grade: string;
  target: number | null;
}

export interface MonthlyTargetSource {
  label: string;
  capturedOn: string;
  sha256: string;
  teachers: string[];
  grades: string[];
  cells: Array<{ teacher: string; grade: string; actual: number; undated: number }>;
  enrollments: number;
  enrollmentTarget: number;
  arrivals: number;
  arrivalTarget: number;
  invitations: number;
  invitationTarget: number;
  missingDate: number;
  unassignedTeacher: number;
}

export interface MonthlyTargetPlan {
  month: string;
  revision: number;
  cells: MonthlyTargetCell[];
  enrollmentTarget: number | null;
  arrivalTarget: number | null;
  invitationTarget: number | null;
  basis: "source" | "teacher_grade";
  source: MonthlyTargetSource;
  updatedAt: string;
}

export type MonthlyTargetRead = { available: true; plan: MonthlyTargetPlan | null } | { available: false; plan: null };

export function monthlyTargetCellKey(teacher: string, grade: string) {
  return JSON.stringify([teacher, grade]);
}

/** 空白表示尚未分配，显式 0 表示该老师在该年级本月没有新增目标。 */
export function sumMonthlyTargets(cells: readonly MonthlyTargetCell[]): number | null {
  const assigned = cells.filter(cell => cell.target !== null);
  return assigned.length ? assigned.reduce((sum, cell) => sum + cell.target!, 0) : null;
}

export function parseMonthlyTargetInput(value: string, maximum = 9999): number | null | undefined {
  if (!value.trim()) return null;
  if (!/^\d+$/.test(value)) return undefined;
  const result = Number(value);
  return Number.isSafeInteger(result) && result <= maximum ? result : undefined;
}

export function monthlyTargetCells(plan: MonthlyTargetPlan): MonthlyTargetCell[] {
  const saved = new Map(plan.cells.map(cell => [monthlyTargetCellKey(cell.teacher, cell.grade), cell.target]));
  return plan.source.teachers.flatMap(teacher => plan.source.grades.map(grade => ({
    teacher, grade, target: saved.get(monthlyTargetCellKey(teacher, grade)) ?? null,
  })));
}

import type { EnrollmentWorkflowOptions } from "./enrollment-workflow-contract";
import type { PlacementRosterRow } from "./placement-table-fields";
import type { TeachingGrouping } from "./teaching-workbench/teaching-grouping-contract";

export type ClassRosterTerm = EnrollmentWorkflowOptions["terms"][number];

export function classRosterTermOptions(terms: ClassRosterTerm[]) {
  return [...terms].sort((a, b) => (a.startsOn ?? a.name).localeCompare(b.startsOn ?? b.name) || a.id.localeCompare(b.id));
}

export type ClassRosterSection = { key: string; teacherName?: string; rows: PlacementRosterRow[] };

/** 名册只改变分组，班内学生与选座所需的原年级、学期始终留在行上。 */
export function classRosterSections(rows: PlacementRosterRow[], grouping: TeachingGrouping, locale: string): ClassRosterSection[] {
  const groups = new Map<string, ClassRosterSection>();
  for (const row of rows) {
    const teachers = row.classroom?.teachers?.length ? row.classroom.teachers
      : [{ id: row.classroom?.teacherNames || row.historical?.teacher_label || "unassigned", name: row.classroom?.teacherNames || row.historical?.teacher_label || "" }];
    const entries = grouping === "grade" || (!row.classroom && !row.historical)
      ? [{ key: row.group, teacherName: undefined }]
      : teachers.map(teacher => ({ key: `teacher:${teacher.id}:${row.termId}`, teacherName: teacher.name }));
    for (const entry of entries) {
      const group = groups.get(entry.key) ?? { ...entry, rows: [] };
      group.rows.push(row);
      groups.set(entry.key, group);
    }
  }
  const sections = [...groups.values()];
  return grouping === "grade" ? sections : sections.sort((a, b) =>
    Number(a.teacherName !== undefined) - Number(b.teacherName !== undefined)
    || (a.teacherName ?? "").localeCompare(b.teacherName ?? "", locale));
}

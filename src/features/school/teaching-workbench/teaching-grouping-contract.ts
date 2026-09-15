import { groupTeachingClasses, type TeachingClassOverview } from "./teaching-class-overview-contract";

export type TeachingGrouping = "grade" | "teacher";
export const teachingGrouping = (value: unknown): TeachingGrouping => value === "teacher" ? "teacher" : "grade";
type ClassRow = ReturnType<typeof groupTeachingClasses>[number];
export type TeachingClassSection = { id: string; name: string | null; grade: number | null; rows: ClassRow[] };

/** 字段筛选后分组；任课变更按实际课次拆分，同一课次的共同教师各自可见。 */
export function groupTeachingClassSections(data: TeachingClassOverview, rows: ClassRow[], grouping: TeachingGrouping, locale: string, teacher?: string): TeachingClassSection[] {
  if (grouping === "grade") {
    const sections = new Map<number | null, ClassRow[]>();
    for (const row of rows) sections.set(row.grade, [...(sections.get(row.grade) ?? []), row]);
    return [...sections].sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity))
      .map(([grade, items]) => ({ id: `grade:${grade ?? "unset"}`, grade, name: null, rows: items }));
  }
  const people = new Map<string, string | null>();
  for (const row of rows) for (const session of row.sessions) {
    if (session.teachers.length === 0) people.set("unassigned", null);
    for (const person of session.teachers) people.set(person.id, person.name);
  }
  const order = new Map(rows.map((row, index) => [row.id, index]));
  return [...people].filter(([id]) => !teacher || id === teacher)
    .sort(([a, nameA], [b, nameB]) => a === "unassigned" ? 1 : b === "unassigned" ? -1 : (nameA ?? "").localeCompare(nameB ?? "", locale))
    .map(([id, name]) => ({ id: `teacher:${id}`, name, grade: null,
      rows: groupTeachingClasses(data, id).filter(row => order.has(row.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!),
    }));
}

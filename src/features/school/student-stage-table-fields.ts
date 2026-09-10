import { studentStageMessages } from "./student-stage-messages";
import { schoolCollaborationMessages } from "./school-collaboration-contract";
import { STUDENT_STAGE_DETAILS, type StudentStage, type StudentStageRow } from "./student-stage-contract";
import type { DashboardFieldDefinitions, DashboardFieldQuery } from "./dashboard-page/dashboard-table-field-contract";

export const STUDENT_STAGE_TABLE_COLUMNS = {
  name: ["name", "grade"], phone: ["phone"], state: ["detail", "scope", "owner", "group"],
  background: ["course", "term", "assessmentBand", "assessmentAt"],
  teacher: ["teacher"], recent: ["note", "lastContactAt"],
} as const;

export function studentStageTableFields(locale: string, stage: StudentStage, currentUserId: string): DashboardFieldDefinitions<StudentStageRow> {
  const m = studentStageMessages(locale), en = locale.startsWith("en");
  const collaboration = schoolCollaborationMessages(locale);
  const option = (value: string | null, label: string) => value ? [{ value, label: label || value }] : [];
  const people = (row: StudentStageRow, teaching: boolean) => row.participants?.filter(person => teaching
    ? person.role === "teacher" || person.role === "assessment_teacher" : person.role === "school_support").map(person => ({ value: person.userId, label: person.name })) ?? [];
  const fields: DashboardFieldDefinitions<StudentStageRow> = {
    name: { kind: "text", label: m.name, value: row => row.name },
    phone: { kind: "text", label: m.phone, value: row => row.phone },
    grade: { kind: "enum", label: en ? "Grade" : "年级", values: row => option(row.grade ? String(row.grade) : row.gradeText, row.gradeText || (row.grade ? String(row.grade) : "")), sortValue: row => row.grade ?? row.gradeText },
    detail: { kind: "enum", label: m.state, values: row => option(row.detail, m.details[row.detail] ?? row.detail),
      options: [...new Set(Object.values(STUDENT_STAGE_DETAILS).flat())].map(value => ({ value, label: m.details[value] ?? value })) },
    scope: { kind: "enum", label: collaboration.scope, multiple: false, sortable: false,
      options: [{ value: "all", label: m.all }, { value: "mine", label: m.mine }, { value: "group", label: collaboration.group }, { value: "unassigned", label: m.unassigned }],
      values: row => [{ value: "all", label: m.all }, ...(row.isParticipant ?? row.ownerId === currentUserId ? [{ value: "mine", label: m.mine }] : []),
        ...(row.inMyGroups ? [{ value: "group", label: collaboration.group }] : []), ...(!row.ownerId ? [{ value: "unassigned", label: m.unassigned }] : [])] },
    group: { kind: "enum", label: collaboration.title, values: row => (row.groups ?? []).map(group => ({ value: group.id, label: group.name })),
      sortValue: row => row.groups?.map(group => group.name).join("、") || null },
    owner: { kind: "enum", label: m.owner, values: row => people(row, false).length ? people(row, false) : option(row.ownerName ? row.ownerId ?? `source:${row.ownerName}` : null, row.ownerName), sortValue: row => row.ownerName || null },
    note: { kind: "text", label: m.recent, value: row => row.note, sortable: false },
    lastContactAt: { kind: "date", label: en ? "Last contact" : "最近联系时间", value: row => row.lastContactAt },
  };
  if (stage !== "awaiting_first_contact" && stage !== "awaiting_assessment") Object.assign(fields, {
    teacher: { kind: "enum", label: m.teacher, values: (row: StudentStageRow) => people(row, true).length ? people(row, true) : option(row.teacherId ?? (row.teacherName ? `source:${row.teacherName}` : null), row.teacherName ?? ""), sortValue: (row: StudentStageRow) => row.teacherName || null },
    course: { kind: "enum", label: m.course, values: (row: StudentStageRow) => option(row.courseId, row.courseTitle) },
    term: { kind: "enum", label: m.term, values: (row: StudentStageRow) => option(row.termId, row.termName) },
    assessmentBand: { kind: "enum", label: en ? "Assessment band" : "测评级别", values: (row: StudentStageRow) => option(row.assessmentBand, row.assessmentBand?.toUpperCase().replaceAll("_PLUS", "+") ?? "") },
    assessmentAt: { kind: "date", label: en ? "Assessment date" : "测评时间", value: (row: StudentStageRow) => row.assessmentAt },
  } satisfies DashboardFieldDefinitions<StudentStageRow>);
  return fields;
}

export function studentStageFieldScope(query: DashboardFieldQuery): "mine" | "all" | "unassigned" | "group" {
  const filter = query.filters.scope;
  const value = filter?.kind === "enum" ? filter.values[0] : "all";
  return value === "mine" || value === "unassigned" || value === "group" ? value : "all";
}

/** 跨阶段或全名单搜索时清除阶段细分，其他列条件与排序继续保留。 */
export function studentStageFieldsAcrossStages(query: DashboardFieldQuery): string {
  return JSON.stringify({ ...query, filters: Object.fromEntries(Object.entries(query.filters).filter(([id]) => id !== "detail")),
    sort: query.sort?.field === "detail" ? null : query.sort });
}

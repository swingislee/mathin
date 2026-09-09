import type { HistoricalEnrollment } from "./student-business-history-contract";
import { placementHealth, type EnrollmentPlacementBoard, type PlacementClassroom, type PlacementStudent } from "./enrollment-workflow-contract";
import { zonedDateParts } from "./schedule";
import { followupTableMessages } from "./followup-table-messages";
import type { DashboardFieldDefinitions, DashboardFieldOption } from "./dashboard-page/dashboard-table-field-contract";

export interface PlacementRosterRow {
  historical?: HistoricalEnrollment;
  sourceEnrollments?: HistoricalEnrollment[];
  key: string; group: string; grade: number; termId: string;
  classroom: PlacementClassroom | null; classrooms: PlacementClassroom[]; students: PlacementStudent[];
}
export const PLACEMENT_TABLE_COLUMNS = {
  grade: ["grade"], term: ["term"], course: ["course"], difficulty: ["difficulty"], classroom: ["classroom", "classText"],
  teacher: ["teacher", "teacherText"], time: ["weekday", "startTime", "endTime", "scheduleText"], health: ["student", "phone", "health"],
} as const;
type Translate = (key: string, values?: Record<string, string | number>) => string;
const option = (value: string | null | undefined, label = value): DashboardFieldOption[] => value ? [{ value, label: label || value }] : [];
const classes = (row: PlacementRosterRow) => row.classroom ? [row.classroom] : row.classrooms;
const related = { group: "class-session", rows: (row: PlacementRosterRow): PlacementRosterRow[] => {
  const values = classes(row);
  return values.length ? values.flatMap(classroom => classroom.sessions.length
    ? classroom.sessions.map(session => ({ ...row, classroom: { ...classroom, sessions: [session] } })) : [{ ...row, classroom }]) : [row];
} };

export function placementTableFields(board: EnrollmentPlacementBoard, locale: string, timeZone: string, t: Translate,
  sourceNames: (row: PlacementRosterRow) => { names: string; phones: string }): DashboardFieldDefinitions<PlacementRosterRow> {
  const m = followupTableMessages(locale);
  const studentRelated = { group: "placement-student", rows: (row: PlacementRosterRow): PlacementRosterRow[] => row.students.length
    ? row.students.map(student => ({ ...row, students: [student], sourceEnrollments: [] }))
    : row.sourceEnrollments?.length ? row.sourceEnrollments.map(fact => ({ ...row, sourceEnrollments: [fact] })) : [row] };
  const terms = new Map(board.options.terms.map(row => [row.id, row.name]));
  const courses = new Map(board.options.courses.map(row => [row.id, row.title]));
  const difficulties = new Map(board.options.courses.map(row => [row.id, row.classType]));
  const sessionParts = (row: PlacementRosterRow, end = false) => {
    const session = row.classroom?.sessions[0];
    return session ? zonedDateParts(new Date(Date.parse(session.at) + (end ? session.duration * 60_000 : 0)), timeZone) : null;
  };
  const clock = (row: PlacementRosterRow, end = false) => {
    const parts = sessionParts(row, end);
    return parts ? `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}` : "";
  };
  const weekday = (at: string) => {
    const parts = zonedDateParts(new Date(at), timeZone);
    return parts.weekday || 7;
  };
  const weekdays = Array.from({ length: 7 }, (_, index) => ({ value: String(index + 1), label: new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 8, 7 + index))) }));
  return {
    grade: { kind: "enum", label: m.grade, values: row => row.grade ? option(String(row.grade), t("grade", { grade: row.grade })) : [], sortValue: row => row.grade || null },
    term: { kind: "enum", label: t("term"), values: row => terms.has(row.termId) ? option(row.termId, terms.get(row.termId)) : [], sortValue: row => terms.get(row.termId) },
    course: { kind: "enum", label: m.course, related, values: row => [...new Set(row.classroom ? [row.classroom.courseId] : [...row.classrooms.map(item => item.courseId), ...row.students.map(item => item.courseId)])].flatMap(id => option(id, courses.get(id))), sortValue: row => courses.get(row.classroom?.courseId ?? "") },
    classroom: { kind: "enum", label: t("classroom"), related, values: row => classes(row).flatMap(item => option(item.id, item.name)), sortValue: row => row.classroom?.name },
    difficulty: { kind: "enum", label: locale === "en" ? "Level" : "难度", related, values: row => classes(row).flatMap(item => option(difficulties.get(item.courseId))), sortValue: row => difficulties.get(row.classroom?.courseId ?? "") },
    classText: { kind: "text", label: m.sourceText, value: row => row.historical ? [row.historical.period_label, row.historical.class_label, row.historical.room_label].join(" ") : "", sortable: false },
    teacher: { kind: "enum", label: m.teacher, related, values: row => classes(row).flatMap(item => (item.teachers ?? []).flatMap(person => option(person.id, person.name))), sortValue: row => row.classroom?.teacherNames },
    teacherText: { kind: "text", label: m.sourceText, value: row => row.historical?.teacher_label ?? "", sortable: false },
    weekday: { kind: "enum", label: m.weekday, related, options: weekdays, values: row => classes(row).flatMap(item => item.sessions.flatMap(session => option(String(weekday(session.at)), weekdays[weekday(session.at) - 1].label))), sortValue: row => row.classroom?.sessions[0] ? weekday(row.classroom.sessions[0].at) : null },
    startTime: { kind: "text", label: m.startTime, related, value: row => clock(row) },
    endTime: { kind: "text", label: m.endTime, related, value: row => clock(row, true) },
    scheduleText: { kind: "text", label: m.sourceText, value: row => row.historical?.schedule_label ?? "", sortable: false },
    student: { kind: "text", label: m.student, related: studentRelated, value: row => [row.students.map(item => item.name).join(" "), sourceNames(row).names].join(" "), sortable: false },
    phone: { kind: "text", label: m.phone, related: studentRelated, value: row => [row.students.map(item => item.phone).join(" "), sourceNames(row).phones].join(" "), sortable: false },
    health: { kind: "enum", label: t("student"), related: studentRelated, values: row => row.students.map(student => { const tone = placementHealth(board.health?.[student.studentId]).tone; return { value: tone, label: t(`legend_${tone}`) }; }), sortable: false },
  };
}

import { overviewFactInPeriod, summarizeTeacherParticipationOutcomes, type StaffOverviewMetric, type StaffOverviewWindow, type StaffOverviewTeacherParticipationEvent, type StaffOverviewEnrollmentOutcomeEvent } from "./staff-overview-contract";

export interface OverviewDetailQuery {
  kind: "business" | "support" | "participation" | "capacity" | "pending";
  metric?: StaffOverviewMetric | "participants" | "unattributed" | "conversion" | string;
  scope?: string;
  group?: "teacher" | "grade" | "class";
  period?: "current" | "previous";
}
export interface OverviewDetailRecord {
  id: string;
  at?: string;
  sourceMonth?: string | null;
  sourceName?: string;
  sourceConfirmed?: boolean;
  studentId?: string | null;
  leadId?: string | null;
  sourceId?: string | null;
  name?: string;
  person?: string;
  href?: string;
  values?: Array<{ label: string; value: string }>;
}
export interface OverviewDetailResult {
  people: string[];
  available: boolean;
  records: OverviewDetailRecord[];
  total: number;
  filteredTotal: number;
  page: number;
  pageSize: number;
  range: string;
  timeZone: string;
}

export const OVERVIEW_DETAIL_SORTS = ["date_desc", "date_asc", "name_asc", "name_desc", "person_asc", "person_desc"] as const;
export type OverviewDetailSort = typeof OVERVIEW_DETAIL_SORTS[number];

/** 筛选和排序在分页前执行，空值始终排在最后，同值以记录 ID 稳定排序。 */
export function filterOverviewDetailRecords(records: readonly OverviewDetailRecord[], search: string, person: string, sort: OverviewDetailSort) {
  const term = search.trim().toLocaleLowerCase();
  const [field, direction] = sort.split("_");
  const value = (row: OverviewDetailRecord) => field === "date" ? row.at || row.sourceMonth : field === "name" ? row.name : row.person;
  return records.filter(row => (person === "all" || (person === "empty" ? !row.person : `person:${row.person}` === person))
    && (!term || [row.name, row.person, ...(row.values ?? []).map(item => item.value)].some(item => item?.toLocaleLowerCase().includes(term))))
    .sort((a, b) => {
      const left = value(a), right = value(b);
      if (!left || !right) return left ? -1 : right ? 1 : a.id.localeCompare(b.id);
      const comparison = field === "date" ? Date.parse(left) - Date.parse(right) : left.localeCompare(right, "zh-CN", { numeric: true });
      return (direction === "desc" ? -comparison : comparison) || a.id.localeCompare(b.id);
    });
}

/** 邀约按机构或人员分别去重，保留“其他人员”合计中的归属贡献。 */
export function selectOverviewDetailEvents<T extends { id: string; at: string; sourceMonth?: string | null; personId: string | null }>(
  events: readonly T[], window: StaffOverviewWindow, query: OverviewDetailQuery, selectedSupportIds: readonly string[] = [],
): T[] {
  const period = query.period ?? "current";
  const seen = new Set<string>();
  return events.filter(event => {
    if (!overviewFactInPeriod(event, window, period)) return false;
    if (query.kind === "support" && query.scope) {
      if (query.scope === "__unassigned__" ? event.personId !== null
        : query.scope === "__other__" ? event.personId === null || selectedSupportIds.includes(event.personId)
          : event.personId !== query.scope) return false;
    }
    if (query.metric !== "invitations") return true;
    const key = query.kind === "support" ? `${event.personId}:${event.id}` : event.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 每个学员复用汇总函数判断入选及报名，保证先参与、后报名的时间关系一致。 */
export function selectOverviewParticipants(
  participation: readonly StaffOverviewTeacherParticipationEvent[], enrollments: readonly StaffOverviewEnrollmentOutcomeEvent[],
  window: StaffOverviewWindow, query: OverviewDetailQuery,
): Array<{ studentId: string; enrolled: boolean; at: string }> {
  const period = query.period ?? "current";
  const groups = new Map<string, StaffOverviewTeacherParticipationEvent[]>();
  const enrollmentGroups = new Map<string, StaffOverviewEnrollmentOutcomeEvent[]>();
  participation.forEach(event => groups.set(event.studentId, [...(groups.get(event.studentId) ?? []), event]));
  enrollments.forEach(event => enrollmentGroups.set(event.studentId, [...(enrollmentGroups.get(event.studentId) ?? []), event]));
  return Array.from(groups).flatMap(([studentId, events]) => {
    const summary = summarizeTeacherParticipationOutcomes(events, enrollmentGroups.get(studentId) ?? [], window);
    const teacher = query.scope ? summary.teachers.find(row => row.teacherId === query.scope) : null;
    const count = query.scope ? teacher?.participants[period] ?? 0
      : query.metric === "unattributed" ? summary.unattributedParticipants[period] : summary.totalParticipants[period];
    const enrolled = (query.scope ? teacher?.enrollments[period] ?? 0 : summary.totalEnrollments[period]) > 0;
    const start = period === "current" ? window.currentStart : window.previousStart;
    const cutoff = period === "current" ? window.currentCutoff : window.previousCutoff;
    const at = events.filter(event => new Date(event.at) >= start && new Date(event.at) < cutoff
      && (!query.scope || event.teacherIds.includes(query.scope))).map(event => event.at).sort()[0];
    return count && (query.metric !== "enrollments" || enrolled) ? [{ studentId, enrolled, at }] : [];
  });
}

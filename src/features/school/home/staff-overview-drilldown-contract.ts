import { summarizeTeacherParticipationOutcomes, type StaffOverviewMetric, type StaffOverviewWindow, type StaffOverviewTeacherParticipationEvent, type StaffOverviewEnrollmentOutcomeEvent } from "./staff-overview-contract";

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
  studentId?: string | null;
  leadId?: string | null;
  sourceId?: string | null;
  name?: string;
  person?: string;
  href?: string;
  values?: Array<{ label: string; value: string }>;
}
export interface OverviewDetailResult {
  available: boolean;
  records: OverviewDetailRecord[];
  total: number;
  filteredTotal: number;
  page: number;
  pageSize: number;
  range: string;
  timeZone: string;
}

/** 邀约按机构或人员分别去重，保留“其他人员”合计中的归属贡献。 */
export function selectOverviewDetailEvents<T extends { id: string; at: string; personId: string | null }>(
  events: readonly T[], window: StaffOverviewWindow, query: OverviewDetailQuery, selectedSupportIds: readonly string[] = [],
): T[] {
  const period = query.period ?? "current";
  const start = period === "current" ? window.currentStart : window.previousStart;
  const cutoff = period === "current" ? window.currentCutoff : window.previousCutoff;
  const seen = new Set<string>();
  return events.filter(event => {
    const instant = new Date(event.at);
    if (!(instant >= start && instant < cutoff)) return false;
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

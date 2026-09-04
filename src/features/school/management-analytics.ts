import "server-only";

import { getOrganizationTimezoneV2 } from "@/features/school/organization-locations";
import {
  buildStaffOverviewWindow,
  type StaffOverviewWindow,
} from "@/features/school/home/staff-overview-contract";
import { createClient } from "@/lib/supabase/server";
import {
  buildManagementMetric,
  MANAGEMENT_FUNNEL_STAGES,
  MANAGEMENT_STAGE_EVENT_TIME_FIELDS,
  resolveManagementAttribution,
  resolveManagementRegistrationLead,
  summarizeClassAttendance,
  summarizeManagementActivity,
  summarizeManagementBreakdown,
  summarizeManagementFunnel,
  type ManagementActivitySummary,
  type ManagementAnalyticsGrain,
  type ManagementAnalyticsPeriod,
  type ManagementAnalyticsSourceAccess,
  type ManagementBreakdownRow,
  type ManagementCohortFact,
  type ManagementClassAttendanceSummary,
  type ManagementFunnelCounts,
  type ManagementFunnelStage,
  type ManagementMetricDto,
} from "./management-analytics-contract";

const READ_LIMIT = 10_000;
const ID_CHUNK_SIZE = 180;

export const MANAGEMENT_ANALYTICS_SOURCE_KEYS = [
  "leads",
  "leadSources",
  "communications",
  "invitations",
  "activities",
  "assessments",
  "reminders",
  "staffDirectory",
  "classMemberships",
  "sessions",
  "attendance",
] as const;
export type ManagementAnalyticsSourceKey = (typeof MANAGEMENT_ANALYTICS_SOURCE_KEYS)[number];

export type ManagementFunnelMetrics = Record<ManagementFunnelStage, ManagementMetricDto>;

export interface ManagementAnalyticsBreakdownRow
  extends Omit<ManagementBreakdownRow, "current" | "previous" | "currentFallback" | "previousFallback" | "currentUnresolved" | "previousUnresolved"> {
  current: ManagementFunnelMetrics;
  previous: ManagementFunnelMetrics;
  currentFallback: ManagementFunnelCounts;
  previousFallback: ManagementFunnelCounts;
}

export interface ManagementAnalyticsActivityRow
  extends Omit<ManagementActivitySummary, "assessments"> {
  attendance: ManagementMetricDto;
  assessment: ManagementMetricDto;
  href: string;
}

export interface ManagementAnalyticsActivityTotals {
  registrations: number | null;
  attended: number | null;
  noShows: number | null;
  pendingResults: number | null;
  assessments: number | null;
  attendance: ManagementMetricDto;
  assessment: ManagementMetricDto;
}

export interface ManagementAnalyticsClassAttendanceRow extends ManagementClassAttendanceSummary {
  metric: ManagementMetricDto;
  href: string;
}

export interface ManagementAnalyticsClassAttendanceTotals {
  expected: number | null;
  recorded: number | null;
  attended: number | null;
  absent: number | null;
  leave: number | null;
  missing: number | null;
  unexpected: number | null;
  metric: ManagementMetricDto;
}

export interface ManagementAnalyticsBacklog {
  unassignedLeads: ManagementMetricDto;
  overdueReminders: ManagementMetricDto;
  dueSoonReminders: ManagementMetricDto;
  arrivedWithoutAssessment: ManagementMetricDto;
}

export interface ManagementAnalyticsDependency {
  key: "commercialEnrollment" | "product" | "renewal" | "classAttendance";
  phase: 3 | 4 | 5;
}

export interface ManagementAnalyticsData {
  generatedAt: string;
  timeZone: string;
  grain: ManagementAnalyticsGrain;
  currentStart: string;
  currentCutoff: string;
  previousStart: string;
  previousCutoff: string;
  funnel: Record<ManagementAnalyticsPeriod, ManagementFunnelMetrics>;
  channelRows: ManagementAnalyticsBreakdownRow[];
  batchRows: ManagementAnalyticsBreakdownRow[];
  supportRows: ManagementAnalyticsBreakdownRow[];
  activityRows: ManagementAnalyticsActivityRow[];
  activityTotals: Record<ManagementAnalyticsPeriod, ManagementAnalyticsActivityTotals>;
  classAttendanceRows: ManagementAnalyticsClassAttendanceRow[];
  classAttendanceTotals: Record<ManagementAnalyticsPeriod, ManagementAnalyticsClassAttendanceTotals>;
  backlog: ManagementAnalyticsBacklog;
  dependencies: ManagementAnalyticsDependency[];
  unavailableSources: ManagementAnalyticsSourceKey[];
  truncatedSources: ManagementAnalyticsSourceKey[];
}

interface QueryRowsResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

interface SourceRead<T> {
  rows: T[];
  available: boolean;
  truncated: boolean;
}

interface LeadRow {
  id: string;
  student_id: string | null;
  owner_id: string | null;
}

interface LeadSourceRow {
  lead_id: string;
  batch_id: string;
  batch_label: string;
  source_system: string;
  acquisition_method: string;
  submitted_at: string | null;
  created_at: string;
}

interface CommunicationRow {
  lead_id: string;
  occurred_at: string;
  owner_id_at_contact: string | null;
}

interface InvitationThreadRow {
  id: string;
  lead_id: string;
  activity_id: string | null;
  owner_id_at_open: string | null;
  created_at: string;
}

interface InvitationEventRow {
  invitation_id: string;
  occurred_at: string;
}

interface ActivityRow {
  id: string;
  title: string;
  kind: string;
  scheduled_at: string;
  capacity: number | null;
  source_invitation_id: string | null;
}

interface RegistrationRow {
  id: string;
  activity_id: string;
  lead_id: string | null;
  student_id: string | null;
  status: string;
}

interface AssessmentRow {
  id: string;
  activity_registration_id: string;
  lead_id: string | null;
  student_id: string | null;
  created_at: string;
}

interface ProfileRow {
  id: string;
  display_name: string;
}

interface ClassSessionRow {
  id: string;
  classroom_id: string;
  title: string;
  scheduled_at: string;
}

interface ClassMembershipRow {
  classroom_id: string;
  student_id: string;
  joined_at: string;
  left_at: string | null;
}

interface SessionAttendanceRow {
  session_id: string;
  student_id: string;
  status: string;
}

function limitedRows<T>(result: QueryRowsResult<T>): SourceRead<T> {
  if (result.error) return { rows: [], available: false, truncated: false };
  const rows = result.data ?? [];
  return { rows, available: true, truncated: rows.length >= READ_LIMIT };
}

async function readByIds<T>(
  ids: readonly string[],
  load: (chunk: readonly string[]) => PromiseLike<QueryRowsResult<T>>,
): Promise<SourceRead<T>> {
  if (ids.length === 0) return { rows: [], available: true, truncated: false };
  const rows: T[] = [];
  for (let offset = 0; offset < ids.length; offset += ID_CHUNK_SIZE) {
    const result = await load(ids.slice(offset, offset + ID_CHUNK_SIZE));
    if (result.error) return { rows: [], available: false, truncated: false };
    rows.push(...(result.data ?? []));
    if (rows.length >= READ_LIMIT) {
      return { rows: rows.slice(0, READ_LIMIT), available: true, truncated: true };
    }
  }
  return { rows, available: true, truncated: false };
}

function sourceTimestamp(row: LeadSourceRow): number {
  return new Date(row.submitted_at ?? row.created_at).getTime();
}

function periodForSource(row: LeadSourceRow, window: StaffOverviewWindow): ManagementAnalyticsPeriod | null {
  const instant = new Date(sourceTimestamp(row));
  if (instant >= window.currentStart && instant < window.currentCutoff) return "current";
  if (instant >= window.previousStart && instant < window.previousCutoff) return "previous";
  return null;
}

function occurredWithinCohort(
  cohortAt: string,
  occurredAt: string,
  period: ManagementAnalyticsPeriod,
  window: StaffOverviewWindow,
): boolean {
  const occurred = new Date(occurredAt);
  const cohortInstant = new Date(cohortAt);
  const cutoff = period === "current" ? window.currentCutoff : window.previousCutoff;
  return !Number.isNaN(occurred.getTime()) && occurred >= cohortInstant && occurred < cutoff;
}

function firstSourceByLead(rows: readonly LeadSourceRow[]): Map<string, LeadSourceRow> {
  const result = new Map<string, LeadSourceRow>();
  for (const row of [...rows].sort((left, right) => sourceTimestamp(left) - sourceTimestamp(right))) {
    if (!result.has(row.lead_id)) result.set(row.lead_id, row);
  }
  return result;
}

function normalizedChannel(source: LeadSourceRow | undefined): { key: string; label: string; detail: string } {
  const acquisition = source?.acquisition_method.trim() ?? "";
  const sourceSystem = source?.source_system.trim() ?? "";
  const label = acquisition || sourceSystem;
  return {
    key: label ? label.toLocaleLowerCase() : "__unknown_channel__",
    label,
    detail: acquisition && sourceSystem ? sourceSystem : "",
  };
}

function funnelMetrics(
  counts: ManagementFunnelCounts,
  exact: Readonly<Record<ManagementFunnelStage, boolean>>,
  unresolved: ManagementFunnelCounts,
  grain: ManagementAnalyticsGrain,
  cohort: ManagementAnalyticsPeriod,
  attributionRule: string,
): ManagementFunnelMetrics {
  return Object.fromEntries(MANAGEMENT_FUNNEL_STAGES.map((stage) => [
    stage,
    buildManagementMetric({
      numerator: exact[stage] ? counts[stage] : null,
      denominator: stage === "leads"
        ? null
        : exact[stage] && exact.leads
          ? counts.leads
          : null,
      grain,
      cohort,
      eventTimeField: MANAGEMENT_STAGE_EVENT_TIME_FIELDS[stage],
      attributionRule,
      unresolvedCount: exact[stage] ? unresolved[stage] : null,
    }),
  ])) as unknown as ManagementFunnelMetrics;
}

function metricBreakdown(
  rows: readonly ManagementBreakdownRow[],
  exact: Readonly<Record<ManagementFunnelStage, boolean>>,
  grain: ManagementAnalyticsGrain,
  attributionRule: string,
): ManagementAnalyticsBreakdownRow[] {
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    detail: row.detail,
    current: funnelMetrics(row.current, exact, row.currentUnresolved, grain, "current", attributionRule),
    previous: funnelMetrics(row.previous, exact, row.previousUnresolved, grain, "previous", attributionRule),
    currentFallback: row.currentFallback,
    previousFallback: row.previousFallback,
  }));
}

function activityPeriod(scheduledAt: string, window: StaffOverviewWindow): ManagementAnalyticsPeriod | null {
  const instant = new Date(scheduledAt);
  if (instant >= window.currentStart && instant < window.currentCutoff) return "current";
  if (instant >= window.previousStart && instant < window.previousCutoff) return "previous";
  return null;
}

interface ActivityTotalsCounts {
  registrations: number;
  attended: number;
  noShows: number;
  pendingResults: number;
  assessments: number;
}

function emptyActivityTotals(): ActivityTotalsCounts {
  return {
    registrations: 0,
    attended: 0,
    noShows: 0,
    pendingResults: 0,
    assessments: 0,
  };
}

function activityMetrics(
  counts: ActivityTotalsCounts,
  grain: ManagementAnalyticsGrain,
  cohort: ManagementAnalyticsPeriod,
  activityExact: boolean,
  assessmentExact: boolean,
): ManagementAnalyticsActivityTotals {
  const registrations = activityExact ? counts.registrations : null;
  const attended = activityExact ? counts.attended : null;
  const assessments = activityExact && assessmentExact ? counts.assessments : null;
  return {
    registrations,
    attended,
    noShows: activityExact ? counts.noShows : null,
    pendingResults: activityExact ? counts.pendingResults : null,
    assessments,
    attendance: buildManagementMetric({
      numerator: attended,
      denominator: registrations,
      grain,
      cohort,
      eventTimeField: MANAGEMENT_STAGE_EVENT_TIME_FIELDS.arrivals,
      attributionRule: "activity_registration_status",
      unresolvedCount: activityExact ? 0 : null,
    }),
    assessment: buildManagementMetric({
      numerator: assessments,
      denominator: attended,
      grain,
      cohort,
      eventTimeField: MANAGEMENT_STAGE_EVENT_TIME_FIELDS.assessments,
      attributionRule: "assessment_result_to_registration",
      unresolvedCount: activityExact && assessmentExact ? 0 : null,
    }),
  };
}

interface ClassAttendanceTotalsCounts {
  expected: number;
  recorded: number;
  attended: number;
  absent: number;
  leave: number;
  missing: number;
  unexpected: number;
}

function emptyClassAttendanceTotals(): ClassAttendanceTotalsCounts {
  return { expected: 0, recorded: 0, attended: 0, absent: 0, leave: 0, missing: 0, unexpected: 0 };
}

function classAttendanceMetrics(
  counts: ClassAttendanceTotalsCounts,
  grain: ManagementAnalyticsGrain,
  cohort: ManagementAnalyticsPeriod,
  exact: boolean,
): ManagementAnalyticsClassAttendanceTotals {
  const value = (count: number) => exact ? count : null;
  const expected = value(counts.expected);
  const attended = value(counts.attended);
  return {
    expected,
    recorded: value(counts.recorded),
    attended,
    absent: value(counts.absent),
    leave: value(counts.leave),
    missing: value(counts.missing),
    unexpected: value(counts.unexpected),
    metric: buildManagementMetric({
      numerator: attended,
      denominator: expected,
      grain,
      cohort,
      eventTimeField: "class_sessions.scheduled_at + session_attendance.status",
      attributionRule: "membership_valid_when_session_scheduled",
      unresolvedCount: exact ? counts.missing + counts.unexpected : null,
    }),
  };
}

export async function getManagementAnalyticsData({
  grain,
  sourceAccess,
  now = new Date(),
}: {
  grain: ManagementAnalyticsGrain;
  sourceAccess: ManagementAnalyticsSourceAccess;
  now?: Date;
}): Promise<ManagementAnalyticsData> {
  const [supabase, timeZone] = await Promise.all([createClient(), getOrganizationTimezoneV2()]);
  const window = buildStaffOverviewWindow(grain, now, timeZone);
  const rangeStart = window.previousStart.toISOString();
  const rangeEnd = window.currentCutoff.toISOString();
  const activeLeadStates = ["unassigned", "uncontacted", "contacted", "nurture", "intent_confirmed"];

  const sourceWindowFilter = [
    `and(submitted_at.gte.${rangeStart},submitted_at.lt.${rangeEnd})`,
    `and(submitted_at.is.null,created_at.gte.${rangeStart},created_at.lt.${rangeEnd})`,
  ].join(",");
  const [sourceCohortResult, activityResult, sessionResult, unassignedResult, overdueResult, dueSoonResult] = await Promise.all([
    supabase
      .from("lead_source_records")
      .select("lead_id,batch_id,batch_label,source_system,acquisition_method,submitted_at,created_at")
      .or(sourceWindowFilter)
      .order("created_at", { ascending: true })
      .limit(READ_LIMIT)
      .returns<LeadSourceRow[]>(),
    supabase
      .from("activities")
      .select("id,title,kind,scheduled_at,capacity,source_invitation_id")
      .is("deleted_at", null)
      .gte("scheduled_at", rangeStart)
      .lt("scheduled_at", rangeEnd)
      .order("scheduled_at", { ascending: false })
      .limit(READ_LIMIT)
      .returns<ActivityRow[]>(),
    supabase
      .from("class_sessions")
      .select("id,classroom_id,title,scheduled_at")
      .not("scheduled_at", "is", null)
      .is("voided_at", null)
      .is("deleted_at", null)
      .gte("scheduled_at", rangeStart)
      .lt("scheduled_at", rangeEnd)
      .order("scheduled_at", { ascending: false })
      .limit(READ_LIMIT)
      .returns<ClassSessionRow[]>(),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .in("status", activeLeadStates)
      .is("owner_id", null),
    supabase
      .from("lead_next_actions")
      .select("lead_id", { count: "exact", head: true })
      .eq("status", "open")
      .lt("due_at", now.toISOString()),
    supabase
      .from("lead_next_actions")
      .select("lead_id", { count: "exact", head: true })
      .eq("status", "open")
      .gte("due_at", now.toISOString())
      .lt("due_at", new Date(now.getTime() + 7 * 86_400_000).toISOString()),
  ]);

  const sourceCandidatesRead = limitedRows(sourceCohortResult);
  const activitiesRead = limitedRows(activityResult);
  const sessionsRead = limitedRows(sessionResult);
  const candidateLeadIds = [...new Set(sourceCandidatesRead.rows.map((row) => row.lead_id))];
  const activityIds = activitiesRead.rows.map((row) => row.id);
  const sessionIds = sessionsRead.rows.map((row) => row.id);
  const classroomIds = [...new Set(sessionsRead.rows.map((row) => row.classroom_id))];

  const [
    baseLeadsRead,
    allSourcesRead,
    communicationsRead,
    invitationThreadsRead,
    registrationsRead,
    classMembershipsRead,
    attendanceRead,
  ] = await Promise.all([
    readByIds<LeadRow>(candidateLeadIds, (ids) => supabase
      .from("leads")
      .select("id,student_id,owner_id")
      .in("id", [...ids])
      .limit(READ_LIMIT)
      .returns<LeadRow[]>()),
    readByIds<LeadSourceRow>(candidateLeadIds, (ids) => supabase
      .from("lead_source_records")
      .select("lead_id,batch_id,batch_label,source_system,acquisition_method,submitted_at,created_at")
      .in("lead_id", [...ids])
      .order("created_at", { ascending: true })
      .limit(READ_LIMIT)
      .returns<LeadSourceRow[]>()),
    readByIds<CommunicationRow>(candidateLeadIds, (ids) => supabase
      .from("lead_communications")
      .select("lead_id,occurred_at,owner_id_at_contact")
      .in("lead_id", [...ids])
      .eq("outcome", "connected")
      .lt("occurred_at", rangeEnd)
      .limit(READ_LIMIT)
      .returns<CommunicationRow[]>()),
    readByIds<InvitationThreadRow>(candidateLeadIds, (ids) => supabase
      .from("lead_invitation_threads")
      .select("id,lead_id,activity_id,owner_id_at_open,created_at")
      .in("lead_id", [...ids])
      .limit(READ_LIMIT)
      .returns<InvitationThreadRow[]>()),
    readByIds<RegistrationRow>(activityIds, (ids) => supabase
      .from("activity_registrations")
      .select("id,activity_id,lead_id,student_id,status")
      .in("activity_id", [...ids])
      .limit(READ_LIMIT)
      .returns<RegistrationRow[]>()),
    readByIds<ClassMembershipRow>(classroomIds, (ids) => supabase
      .from("enrollments")
      .select("classroom_id,student_id,joined_at,left_at")
      .in("classroom_id", [...ids])
      .limit(READ_LIMIT)
      .returns<ClassMembershipRow[]>()),
    readByIds<SessionAttendanceRow>(sessionIds, (ids) => supabase
      .from("session_attendance")
      .select("session_id,student_id,status")
      .in("session_id", [...ids])
      .limit(READ_LIMIT)
      .returns<SessionAttendanceRow[]>()),
  ]);

  const leadsRead: SourceRead<LeadRow> = sourceCandidatesRead.available
    ? baseLeadsRead
    : { rows: [], available: false, truncated: false };
  const sourcesRead: SourceRead<LeadSourceRow> = sourceCandidatesRead.available && allSourcesRead.available
    ? {
      rows: allSourcesRead.rows,
      available: true,
      truncated: sourceCandidatesRead.truncated || allSourcesRead.truncated,
    }
    : { rows: [], available: false, truncated: false };
  const invitationIds = invitationThreadsRead.rows.map((row) => row.id);
  const registrationIds = registrationsRead.rows.map((row) => row.id);
  const [invitationEventsRead, assessmentsRead] = await Promise.all([
    readByIds<InvitationEventRow>(invitationIds, (ids) => supabase
      .from("lead_invitation_events")
      .select("invitation_id,occurred_at")
      .in("invitation_id", [...ids])
      .eq("to_state", "confirmed")
      .lt("occurred_at", rangeEnd)
      .limit(READ_LIMIT)
      .returns<InvitationEventRow[]>()),
    readByIds<AssessmentRow>(registrationIds, (ids) => supabase
      .from("assessment_results")
      .select("id,activity_registration_id,lead_id,student_id,created_at")
      .in("activity_registration_id", [...ids])
      .lt("created_at", rangeEnd)
      .limit(READ_LIMIT)
      .returns<AssessmentRow[]>()),
  ]);
  const ownerIds = [...new Set([
    ...leadsRead.rows.map((row) => row.owner_id),
    ...communicationsRead.rows.map((row) => row.owner_id_at_contact),
    ...invitationThreadsRead.rows.map((row) => row.owner_id_at_open),
  ].filter((id): id is string => Boolean(id)))];
  const profilesRead = await readByIds<ProfileRow>(ownerIds, (ids) => supabase
    .from("profiles")
    .select("id,display_name")
    .in("id", [...ids])
    .limit(READ_LIMIT)
    .returns<ProfileRow[]>());

  const sourceReads: Record<ManagementAnalyticsSourceKey, SourceRead<unknown>> = {
    leads: sourceAccess.leadFacts ? leadsRead : { rows: [], available: false, truncated: false },
    leadSources: sourceAccess.leadFacts ? sourcesRead : { rows: [], available: false, truncated: false },
    communications: sourceAccess.leadFacts
      ? communicationsRead
      : { rows: [], available: false, truncated: false },
    invitations: sourceAccess.leadFacts && invitationThreadsRead.available && invitationEventsRead.available
      ? { rows: [], available: true, truncated: invitationThreadsRead.truncated || invitationEventsRead.truncated }
      : { rows: [], available: false, truncated: false },
    activities: sourceAccess.activityFacts && activitiesRead.available && registrationsRead.available
      ? { rows: [], available: true, truncated: activitiesRead.truncated || registrationsRead.truncated }
      : { rows: [], available: false, truncated: false },
    assessments: sourceAccess.activityFacts
      ? assessmentsRead
      : { rows: [], available: false, truncated: false },
    reminders: {
      rows: [],
      available: sourceAccess.leadFacts
        && !unassignedResult.error
        && !overdueResult.error
        && !dueSoonResult.error,
      truncated: false,
    },
    staffDirectory: profilesRead,
    classMemberships: sourceAccess.classAttendanceFacts
      ? classMembershipsRead
      : { rows: [], available: false, truncated: false },
    sessions: sourceAccess.classAttendanceFacts
      ? sessionsRead
      : { rows: [], available: false, truncated: false },
    attendance: sourceAccess.classAttendanceFacts
      ? attendanceRead
      : { rows: [], available: false, truncated: false },
  };
  const sourceExact = (key: ManagementAnalyticsSourceKey) => (
    sourceReads[key].available && !sourceReads[key].truncated
  );

  const leadById = new Map(leadsRead.rows.map((row) => [row.id, row]));
  const sourcesByLead = firstSourceByLead(sourcesRead.rows);
  const profileNames = new Map(profilesRead.rows.map((row) => [row.id, row.display_name]));
  const threadById = new Map(invitationThreadsRead.rows.map((row) => [row.id, row]));
  const activityById = new Map(activitiesRead.rows.map((row) => [row.id, row]));

  const activityLeadCandidates = new Map<string, Set<string>>();
  for (const thread of invitationThreadsRead.rows) {
    if (!thread.activity_id) continue;
    const values = activityLeadCandidates.get(thread.activity_id) ?? new Set<string>();
    values.add(thread.lead_id);
    activityLeadCandidates.set(thread.activity_id, values);
  }

  function resolveRegistrationLead(registration: RegistrationRow): string | null {
    const activity = activityById.get(registration.activity_id);
    if (!activity) return null;
    const sourceLeadId = activity.source_invitation_id
      ? threadById.get(activity.source_invitation_id)?.lead_id ?? null
      : null;
    const sourceLead = sourceLeadId ? leadById.get(sourceLeadId) : null;
    const candidateIds = activityLeadCandidates.get(registration.activity_id) ?? new Set<string>();
    return resolveManagementRegistrationLead({
      explicitLeadId: registration.lead_id && leadById.has(registration.lead_id)
        ? registration.lead_id
        : null,
      registrationStudentId: registration.student_id,
      activityKind: activity.kind,
      sourceInvitationLead: sourceLead
        ? { leadId: sourceLead.id, studentId: sourceLead.student_id }
        : null,
      invitationCandidates: Array.from(candidateIds)
        .map((leadId) => leadById.get(leadId))
        .filter((lead): lead is LeadRow => lead !== undefined)
        .map((lead) => ({ leadId: lead.id, studentId: lead.student_id })),
    });
  }

  const connectedByLead = new Map<string, CommunicationRow[]>();
  for (const row of communicationsRead.rows) {
    const values = connectedByLead.get(row.lead_id) ?? [];
    values.push(row);
    connectedByLead.set(row.lead_id, values);
  }
  for (const values of connectedByLead.values()) {
    values.sort((left, right) => new Date(left.occurred_at).getTime() - new Date(right.occurred_at).getTime());
  }
  const threadsByLead = new Map<string, InvitationThreadRow[]>();
  for (const thread of invitationThreadsRead.rows) {
    const values = threadsByLead.get(thread.lead_id) ?? [];
    values.push(thread);
    threadsByLead.set(thread.lead_id, values);
  }
  for (const values of threadsByLead.values()) {
    values.sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());
  }
  const confirmedByLead = new Map<string, string[]>();
  for (const row of invitationEventsRead.rows) {
    const leadId = threadById.get(row.invitation_id)?.lead_id;
    if (!leadId) continue;
    const values = confirmedByLead.get(leadId) ?? [];
    values.push(row.occurred_at);
    confirmedByLead.set(leadId, values);
  }
  const arrivalsByLead = new Map<string, string[]>();
  const leadByRegistration = new Map<string, string>();
  for (const registration of registrationsRead.rows) {
    const activity = activityById.get(registration.activity_id);
    if (!activity) continue;
    const leadId = resolveRegistrationLead(registration);
    if (!leadId) continue;
    leadByRegistration.set(registration.id, leadId);
    if (registration.status !== "attended") continue;
    const values = arrivalsByLead.get(leadId) ?? [];
    values.push(activity.scheduled_at);
    arrivalsByLead.set(leadId, values);
  }
  const assessmentsByLead = new Map<string, string[]>();
  for (const assessment of assessmentsRead.rows) {
    const leadId = assessment.lead_id ?? leadByRegistration.get(assessment.activity_registration_id);
    if (!leadId || !leadById.has(leadId)) continue;
    const values = assessmentsByLead.get(leadId) ?? [];
    values.push(assessment.created_at);
    assessmentsByLead.set(leadId, values);
  }

  const facts: ManagementCohortFact[] = [];
  for (const lead of leadsRead.rows) {
    const source = sourcesByLead.get(lead.id);
    if (!source) continue;
    const period = periodForSource(source, window);
    if (!period) continue;
    const cohortAt = new Date(sourceTimestamp(source)).toISOString();
    const channel = normalizedChannel(source);
    const reached = (events: readonly string[] | undefined) => events?.some((at) => (
      occurredWithinCohort(cohortAt, at, period, window)
    )) ?? false;
    const contactRows = connectedByLead.get(lead.id) ?? [];
    const invitationRows = threadsByLead.get(lead.id) ?? [];
    const firstContact = contactRows.find((row) => (
      occurredWithinCohort(cohortAt, row.occurred_at, period, window)
    ));
    const firstInvitation = invitationRows.find((row) => (
      occurredWithinCohort(cohortAt, row.created_at, period, window)
    ));
    const attribution = resolveManagementAttribution({
      contactOwnerSnapshots: firstContact ? [firstContact.owner_id_at_contact] : [],
      invitationOwnerSnapshots: firstInvitation ? [firstInvitation.owner_id_at_open] : [],
      currentOwnerId: lead.owner_id,
    });
    facts.push({
      leadId: lead.id,
      period,
      cohortAt,
      channelKey: channel.key,
      channelLabel: channel.label,
      channelSource: channel.detail,
      batchKey: source?.batch_id ?? "__no_batch__",
      batchLabel: source?.batch_label.trim() ?? "",
      ownerId: attribution.ownerId,
      ownerName: attribution.ownerId
        ? profileNames.get(attribution.ownerId) ?? attribution.ownerId.slice(0, 8)
        : "",
      ownerResolution: attribution.resolution,
      contacted: reached(contactRows.map((row) => row.occurred_at)),
      invited: reached(confirmedByLead.get(lead.id)),
      arrived: reached(arrivalsByLead.get(lead.id)),
      assessed: reached(assessmentsByLead.get(lead.id)),
    });
  }

  const stageExact: Record<ManagementFunnelStage, boolean> = {
    leads: sourceExact("leads") && sourceExact("leadSources"),
    contacts: sourceExact("leads") && sourceExact("leadSources") && sourceExact("communications"),
    invitations: sourceExact("leads") && sourceExact("leadSources") && sourceExact("invitations"),
    arrivals: sourceExact("leads") && sourceExact("leadSources") && sourceExact("activities") && sourceExact("invitations"),
    assessments: sourceExact("leads") && sourceExact("leadSources") && sourceExact("activities") && sourceExact("assessments") && sourceExact("invitations"),
  };
  const funnel = summarizeManagementFunnel(facts);
  const unresolvedFunnel = summarizeManagementFunnel(facts.filter((fact) => fact.ownerResolution === "unresolved"));
  const breakdownExact = sourceExact("leadSources")
    ? stageExact
    : Object.fromEntries(MANAGEMENT_FUNNEL_STAGES.map((stage) => [stage, false])) as Record<ManagementFunnelStage, boolean>;

  const assessedRegistrationIds = new Set(assessmentsRead.rows.map((row) => row.activity_registration_id));
  const registrationsByActivity = new Map<string, RegistrationRow[]>();
  for (const registration of registrationsRead.rows) {
    const values = registrationsByActivity.get(registration.activity_id) ?? [];
    values.push(registration);
    registrationsByActivity.set(registration.activity_id, values);
  }
  const activitySummaries = activitiesRead.rows.map((activity) => summarizeManagementActivity({
    id: activity.id,
    title: activity.title,
    kind: activity.kind,
    scheduledAt: activity.scheduled_at,
    capacity: activity.capacity,
    registrations: registrationsByActivity.get(activity.id) ?? [],
    assessedRegistrationIds,
  }));
  const activityTotalCounts: Record<ManagementAnalyticsPeriod, ActivityTotalsCounts> = {
    current: emptyActivityTotals(),
    previous: emptyActivityTotals(),
  };
  if (sourceExact("activities")) {
    for (const activity of activitySummaries) {
      const period = activityPeriod(activity.scheduledAt, window);
      if (!period) continue;
      activityTotalCounts[period].registrations += activity.registrations;
      activityTotalCounts[period].attended += activity.attended;
      activityTotalCounts[period].noShows += activity.noShows;
      activityTotalCounts[period].pendingResults += activity.pendingResults;
      if (sourceExact("assessments")) activityTotalCounts[period].assessments += activity.assessments;
    }
  }
  const activityTotals: Record<ManagementAnalyticsPeriod, ManagementAnalyticsActivityTotals> = {
    current: activityMetrics(
      activityTotalCounts.current,
      grain,
      "current",
      sourceExact("activities"),
      sourceExact("assessments"),
    ),
    previous: activityMetrics(
      activityTotalCounts.previous,
      grain,
      "previous",
      sourceExact("activities"),
      sourceExact("assessments"),
    ),
  };

  const currentActivityRows: ManagementAnalyticsActivityRow[] = sourceExact("activities")
    ? activitySummaries
      .filter((activity) => activityPeriod(activity.scheduledAt, window) === "current")
      .slice(0, 100)
      .map((activity) => ({
        id: activity.id,
        title: activity.title,
        kind: activity.kind,
        scheduledAt: activity.scheduledAt,
        capacity: activity.capacity,
        registrations: activity.registrations,
        attended: activity.attended,
        noShows: activity.noShows,
        pendingResults: activity.pendingResults,
        attendance: buildManagementMetric({
          numerator: activity.attended,
          denominator: activity.registrations,
          grain,
          cohort: "current",
          eventTimeField: MANAGEMENT_STAGE_EVENT_TIME_FIELDS.arrivals,
          attributionRule: "activity_registration_status",
          unresolvedCount: 0,
        }),
        assessment: buildManagementMetric({
          numerator: sourceExact("assessments") ? activity.assessments : null,
          denominator: activity.attended,
          grain,
          cohort: "current",
          eventTimeField: MANAGEMENT_STAGE_EVENT_TIME_FIELDS.assessments,
          attributionRule: "assessment_result_to_registration",
          unresolvedCount: sourceExact("assessments") ? 0 : null,
        }),
        href: `/dashboard/activities/${activity.id}`,
      }))
    : [];
  const currentArrivedRegistrationIds = new Set(registrationsRead.rows
    .filter((registration) => {
      const activity = activityById.get(registration.activity_id);
      return registration.status === "attended"
        && activity !== undefined
        && activityPeriod(activity.scheduled_at, window) === "current";
    })
    .map((registration) => registration.id));

  const membershipsByClassroom = new Map<string, ClassMembershipRow[]>();
  for (const membership of classMembershipsRead.rows) {
    const values = membershipsByClassroom.get(membership.classroom_id) ?? [];
    values.push(membership);
    membershipsByClassroom.set(membership.classroom_id, values);
  }
  const attendanceBySession = new Map<string, SessionAttendanceRow[]>();
  for (const attendance of attendanceRead.rows) {
    const values = attendanceBySession.get(attendance.session_id) ?? [];
    values.push(attendance);
    attendanceBySession.set(attendance.session_id, values);
  }
  const classAttendanceExact = sourceExact("sessions")
    && sourceExact("classMemberships")
    && sourceExact("attendance");
  const classAttendanceSummaries = classAttendanceExact
    ? sessionsRead.rows.map((session) => summarizeClassAttendance({
      id: session.id,
      classroomId: session.classroom_id,
      title: session.title,
      scheduledAt: session.scheduled_at,
      memberships: (membershipsByClassroom.get(session.classroom_id) ?? []).map((membership) => ({
        studentId: membership.student_id,
        joinedAt: membership.joined_at,
        leftAt: membership.left_at,
      })),
      attendance: (attendanceBySession.get(session.id) ?? []).map((attendance) => ({
        studentId: attendance.student_id,
        status: attendance.status,
      })),
    }))
    : [];
  const classAttendanceCountTotals: Record<ManagementAnalyticsPeriod, ClassAttendanceTotalsCounts> = {
    current: emptyClassAttendanceTotals(),
    previous: emptyClassAttendanceTotals(),
  };
  for (const session of classAttendanceSummaries) {
    const period = activityPeriod(session.scheduledAt, window);
    if (!period) continue;
    const totals = classAttendanceCountTotals[period];
    totals.expected += session.expected;
    totals.recorded += session.recorded;
    totals.attended += session.attended;
    totals.absent += session.absent;
    totals.leave += session.leave;
    totals.missing += session.missing;
    totals.unexpected += session.unexpected;
  }
  const classAttendanceTotals: Record<ManagementAnalyticsPeriod, ManagementAnalyticsClassAttendanceTotals> = {
    current: classAttendanceMetrics(classAttendanceCountTotals.current, grain, "current", classAttendanceExact),
    previous: classAttendanceMetrics(classAttendanceCountTotals.previous, grain, "previous", classAttendanceExact),
  };
  const classAttendanceRows: ManagementAnalyticsClassAttendanceRow[] = classAttendanceSummaries
    .filter((session) => activityPeriod(session.scheduledAt, window) === "current")
    .slice(0, 100)
    .map((session) => ({
      ...session,
      metric: buildManagementMetric({
        numerator: session.attended,
        denominator: session.expected,
        grain,
        cohort: "current",
        eventTimeField: "class_sessions.scheduled_at + session_attendance.status",
        attributionRule: "membership_valid_when_session_scheduled",
        unresolvedCount: session.missing + session.unexpected,
      }),
      href: `/dashboard/sessions/${session.id}`,
    }));

  return {
    generatedAt: now.toISOString(),
    timeZone,
    grain,
    currentStart: window.currentStart.toISOString(),
    currentCutoff: window.currentCutoff.toISOString(),
    previousStart: window.previousStart.toISOString(),
    previousCutoff: window.previousCutoff.toISOString(),
    funnel: {
      current: funnelMetrics(
        funnel.current,
        stageExact,
        unresolvedFunnel.current,
        grain,
        "current",
        "first_contact_owner_snapshot_then_invitation_snapshot_then_current_lead_owner",
      ),
      previous: funnelMetrics(
        funnel.previous,
        stageExact,
        unresolvedFunnel.previous,
        grain,
        "previous",
        "first_contact_owner_snapshot_then_invitation_snapshot_then_current_lead_owner",
      ),
    },
    channelRows: sourceExact("leadSources")
      ? metricBreakdown(
        summarizeManagementBreakdown(facts, "channel"),
        breakdownExact,
        grain,
        "first_lead_source_record_acquisition_method_then_source_system",
      )
      : [],
    batchRows: sourceExact("leadSources")
      ? metricBreakdown(
        summarizeManagementBreakdown(facts, "batch"),
        breakdownExact,
        grain,
        "first_lead_source_record_batch",
      )
      : [],
    supportRows: sourceExact("staffDirectory") && sourceExact("communications") && sourceExact("invitations")
      ? metricBreakdown(
        summarizeManagementBreakdown(facts, "owner"),
        stageExact,
        grain,
        "first_contact_owner_snapshot_then_invitation_snapshot_then_current_lead_owner",
      )
      : [],
    activityRows: currentActivityRows,
    activityTotals,
    classAttendanceRows,
    classAttendanceTotals,
    backlog: {
      unassignedLeads: buildManagementMetric({
        numerator: !sourceExact("reminders") || unassignedResult.error ? null : unassignedResult.count ?? 0,
        denominator: null,
        grain,
        cohort: "snapshot",
        eventTimeField: "leads.owner_id + leads.status",
        attributionRule: "current_lead_owner",
        unresolvedCount: !sourceExact("reminders") || unassignedResult.error ? null : unassignedResult.count ?? 0,
      }),
      overdueReminders: buildManagementMetric({
        numerator: !sourceExact("reminders") || overdueResult.error ? null : overdueResult.count ?? 0,
        denominator: null,
        grain,
        cohort: "snapshot",
        eventTimeField: "lead_next_actions.due_at",
        attributionRule: "lead_next_action_owner_scope",
        unresolvedCount: !sourceExact("reminders") || overdueResult.error ? null : 0,
      }),
      dueSoonReminders: buildManagementMetric({
        numerator: !sourceExact("reminders") || dueSoonResult.error ? null : dueSoonResult.count ?? 0,
        denominator: null,
        grain,
        cohort: "snapshot",
        eventTimeField: "lead_next_actions.due_at",
        attributionRule: "lead_next_action_owner_scope",
        unresolvedCount: !sourceExact("reminders") || dueSoonResult.error ? null : 0,
      }),
      arrivedWithoutAssessment: buildManagementMetric({
        numerator: !sourceExact("activities") || !sourceExact("assessments")
          ? null
          : Array.from(currentArrivedRegistrationIds).filter((id) => !assessedRegistrationIds.has(id)).length,
        denominator: activityTotals.current.attended,
        grain,
        cohort: "current",
        eventTimeField: `${MANAGEMENT_STAGE_EVENT_TIME_FIELDS.arrivals} vs ${MANAGEMENT_STAGE_EVENT_TIME_FIELDS.assessments}`,
        attributionRule: "registration_without_assessment_result",
        unresolvedCount: !sourceExact("activities") || !sourceExact("assessments") ? null : 0,
      }),
    },
    dependencies: [
      { key: "commercialEnrollment", phase: 3 },
      { key: "product", phase: 3 },
      { key: "renewal", phase: 5 },
    ],
    unavailableSources: MANAGEMENT_ANALYTICS_SOURCE_KEYS.filter((key) => !sourceReads[key].available),
    truncatedSources: MANAGEMENT_ANALYTICS_SOURCE_KEYS.filter((key) => sourceReads[key].truncated),
  };
}

import "server-only";
import { overviewReadSources, type OverviewReadSource } from "./staff-overview-read-contract";
import { readOverviewAcquisitions } from "./staff-overview-acquisition-read";
import { selectOverviewDetailEvents, selectOverviewParticipants, type OverviewDetailQuery, type OverviewDetailRecord } from "./staff-overview-drilldown-contract";

import type { OverviewClassroomOccupancy } from "./staff-overview-presentation-contract";
import { getOrganizationTimezoneV2 } from "@/features/school/organization-locations";
import { createClient } from "@/lib/supabase/server";
import { resolveSourceStaffId, sourceStaffLabel } from "../business-source-contract";
import { readCurrentTermClassroomIds, readOverviewRows, STAFF_OVERVIEW_READ_LIMIT, type OverviewRowsResult } from "./staff-overview-read";
import {
  buildOverviewAcquisitions, type OverviewLeadSubmission,
} from "./staff-overview-acquisition-contract";
import {
  buildOverviewSourceEvents, overviewFactInstant, overviewSubjectKey,
  type OverviewActivity, type OverviewRegistration, type OverviewAssessment,
  type OverviewCourseEnrollment, type OverviewMembership, type OverviewEnrollmentAssignment,
} from "./staff-overview-source-contract";
import {
  aggregateStaffOverviewEvents,
  aggregateStaffOverviewEventsByPerson,
  buildStaffOverviewWindow,
  STAFF_OVERVIEW_METRICS,
  resolveClassroomCapacityPolicy,
  summarizeClassroomCapacity,
  summarizeTeacherParticipationOutcomes,
  type ClassroomCapacityInput,
  type ClassroomCapacityTotals,
  type StaffOverviewComparison,
  type StaffOverviewGrain,
  type StaffOverviewMetric,
  type StaffOverviewTrendPoint,
} from "./staff-overview-contract";

const READ_LIMIT = STAFF_OVERVIEW_READ_LIMIT;

export const STAFF_OVERVIEW_SOURCE_KEYS = [
  "leads",
  "communications",
  "invitations",
  "activities",
  "assessments",
  "enrollments",
  "classrooms",
  "staffAssignments",
  "supportTasks",
  "staffDirectory",
] as const;
export type StaffOverviewSourceKey = (typeof STAFF_OVERVIEW_SOURCE_KEYS)[number];

export type StaffOverviewFactKey = StaffOverviewMetric;
export type StaffOverviewPendingKey =
  | "unassignedLeads"
  | "uncontactedLeads"
  | "overdueLeadActions"
  | "awaitingTeacher"
  | "awaitingParent"
  | "unassessedArrivals"
  | "pendingSupportTasks";

export interface StaffOverviewBusinessFact {
  key: StaffOverviewFactKey;
  current: number | null;
  previous: number | null;
  trend: StaffOverviewTrendPoint[] | null;
}

export interface StaffOverviewPendingFact {
  key: StaffOverviewPendingKey;
  value: number | null;
  href: string;
}

export interface StaffOverviewCapacityRow extends ClassroomCapacityTotals {
  key: string;
  grade: number | null;
}

export interface StaffOverviewTeacherRow {
  userId: string;
  name: string;
  classCount: number | null;
  fullSeats: number | null;
  enrolledSeats: number | null;
  minimumOpenGap: number | null;
  healthyDelta: number | null;
  remainingSeats: number | null;
}

export interface StaffOverviewPersonMetric {
  current: number | null;
  previous: number | null;
}

export interface StaffOverviewSupportFunnelRow {
  key: string;
  userId: string | null;
  name: string;
  metrics: Record<StaffOverviewMetric, StaffOverviewPersonMetric>;
}

export interface StaffOverviewTeacherParticipationRow {
  userId: string;
  name: string;
  participants: StaffOverviewPersonMetric;
  enrollments: StaffOverviewPersonMetric;
}

export interface StaffOverviewTeacherParticipationSummary {
  participants: StaffOverviewPersonMetric;
  enrollments: StaffOverviewPersonMetric;
  unattributedParticipants: StaffOverviewPersonMetric;
}

export interface StaffOverviewSnapshot {
  activeStudents: number | null;
  activeClasses: number | null;
  enrolledSeats: number | null;
  healthyDelta: number | null;
  remainingSeats: number | null;
}

export interface StaffOverviewData {
  detail?: { available: boolean; records: OverviewDetailRecord[] };
  generatedAt: string;
  timeZone: string;
  grain: StaffOverviewGrain;
  isComplete: boolean;
  currentStart: string;
  currentEnd: string;
  currentCutoff: string;
  previousStart: string;
  previousCutoff: string;
  currentTermName: string | null;
  missingDateCounts: Partial<Record<StaffOverviewMetric, number>>;
  snapshot: StaffOverviewSnapshot;
  businessFacts: StaffOverviewBusinessFact[];
  pendingFacts: StaffOverviewPendingFact[];
  supportFunnelRows: StaffOverviewSupportFunnelRow[];
  supportDirectory: Array<{ userId: string; name: string }>;
  teacherParticipationRows: StaffOverviewTeacherParticipationRow[];
  teacherParticipationSummary: StaffOverviewTeacherParticipationSummary;
  capacityByGrade: StaffOverviewCapacityRow[];
  classroomRows: OverviewClassroomOccupancy[];
  capacityAvailable: boolean;
  teacherRows: StaffOverviewTeacherRow[];
  unavailableSources: StaffOverviewSourceKey[];
  truncatedSources: StaffOverviewSourceKey[];
}

export interface StaffHomeWeekSummaryData {
  businessFacts: StaffOverviewBusinessFact[];
  snapshot: Pick<StaffOverviewSnapshot, "activeClasses" | "remainingSeats">;
}

interface LeadDirectoryRow {
  id: string;
  owner_id: string | null;
  status: string;
  student_id: string | null;
  created_at: string;
  source_record_id: string | null;
}

interface CommunicationRow {
  id: string;
  occurred_at: string | null;
  occurred_on: string | null;
  lead_id: string;
  recorded_by: string | null;
  source_record_id: string | null;
  outcome: string;
  owner_id_at_contact: string | null;
}

interface InvitationThreadSummary {
  owner_id_at_open: string | null;
  assessor_id: string | null;
}

interface InvitationEventRow {
  invitation_id: string;
  occurred_at: string;
  to_state: string;
  lead_invitation_threads: InvitationThreadSummary | null;
}

interface InvitationThreadRow {
  id: string;
  activity_id: string | null;
  lead_id: string;
  kind: string;
  state: string;
  owner_id_at_open: string | null;
  assessor_id: string | null;
  scheduled_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ClassroomRow {
  id: string;
  name: string;
  grade: number | null;
  capacity: number | null;
  archived_at: string | null;
  trashed_at: string | null;
}

interface AssignmentRow {
  classroom_id: string;
  user_id: string;
  responsibility: string;
  profiles: { display_name: string } | null;
}

interface LeadActionRow {
  lead_id: string;
  due_at: string;
}

interface SupportTaskRow {
  id: string;
  classroom_id: string;
  student_id: string | null;
  due_at: string | null;
  note: string;
  assigned_to: string | null;
}

interface ProfileRow {
  id: string;
  display_name: string;
  role: string;
  is_active: boolean;
}

interface StaffRoleMemberRow {
  user_id: string;
  staff_roles: { key: string } | null;
}

type QueryRowsResult<T> = OverviewRowsResult<T>;

function emptyCapacityTotals(): ClassroomCapacityTotals {
  return {
    classCount: 0,
    fullSeats: 0,
    enrolledSeats: 0,
    minimumOpenGap: 0,
    healthyDelta: 0,
    remainingSeats: 0,
  };
}

function overviewReader(sources: Set<OverviewReadSource>) {
  return <T>(source: OverviewReadSource, query: Parameters<typeof readOverviewRows<T>>[0], order = ["id"]) =>
    readOverviewRows<T>(query, order, sources.has(source));
}

async function readOverviewCore(supabase: Awaited<ReturnType<typeof createClient>>, sources = overviewReadSources()) {
  const read = overviewReader(sources);
  const [activities, registrations, assessments, courseEnrollments, memberships, enrollmentAssignments, classrooms, currentTerms] = await Promise.all([
    read<OverviewActivity>("activities", () => supabase.from("business_activities" as "activities")
      .select("id,scheduled_at,occurred_on,source_invitation_id,remark,record_state").is("deleted_at", null)),
    read<OverviewRegistration>("registrations", () => supabase.from("business_activity_registrations" as "activity_registrations")
      .select("id,activity_id,student_id,lead_id,status,record_state,registered_on,created_at,source_record_id,assessment_started_at,assessment_completed_at,source_enrollment_facts")),
    read<OverviewAssessment>("assessments", () => supabase.from("business_assessment_results" as "assessment_results")
      .select("id,activity_registration_id,student_id,lead_id,assessed_by,assessed_on,created_at,source_record_id,result_source,result_finalized_at,assessment_band,score,strengths")),
    read<OverviewCourseEnrollment>("courseEnrollments", () => supabase.from("business_course_enrollments" as "course_enrollments")
      .select("id,student_id,opportunity_id,registered_on,confirmed_at,created_at,source_record_id,course_opportunities(student_id,lead_id)")),
    read<OverviewMembership>("memberships", () => supabase.from("enrollments")
      .select("id,classroom_id,student_id,joined_at,status,remark")),
    read<OverviewEnrollmentAssignment>("enrollmentAssignments", () => supabase.from("course_enrollment_assignments")
      .select("id,course_enrollment_id,classroom_membership_id")),
    read<ClassroomRow>("classrooms", () => supabase.from("classrooms")
      .select("id,name,grade,capacity,archived_at,trashed_at").eq("purpose", "production")),
    sources.has("classrooms") ? supabase.from("school_terms").select("id,name").eq("is_current", true).limit(2) : Promise.resolve({ data: [], error: null }),
  ]);
  const termId = !currentTerms.error && currentTerms.data?.length === 1 ? currentTerms.data[0].id : null;
  const currentClassIds = sources.has("classrooms") ? await readCurrentTermClassroomIds(supabase, termId) : { data: [], error: null };
  return { activities, registrations, assessments, courseEnrollments, memberships, enrollmentAssignments, classrooms, currentTerms, currentClassIds };
}

function coreEvents(core: Awaited<ReturnType<typeof readOverviewCore>>, timeZone: string) {
  const productionClassIds = new Set((core.classrooms.data ?? []).map(row => row.id));
  return buildOverviewSourceEvents({
    activities: core.activities.data ?? [], registrations: core.registrations.data ?? [],
    assessments: core.assessments.data ?? [], courseEnrollments: core.courseEnrollments.data ?? [],
    memberships: (core.memberships.data ?? []).filter(row => productionClassIds.has(row.classroom_id)),
    enrollmentAssignments: core.enrollmentAssignments.data ?? [],
  }, timeZone);
}

function datedEvents<T extends { at: string | null }>(events: T[]): Array<T & { at: string }> {
  return events.filter((event): event is T & { at: string } => event.at !== null);
}

function exactRows<T>(result: QueryRowsResult<T>) {
  return !result.error && (result.data?.length ?? 0) < READ_LIMIT;
}

/** 今日工作与总览共用发生日期和当前学期口径，只读取这五个数字依赖的业务事实。 */
export async function getStaffHomeWeekSummaryData({ now = new Date() }: { now?: Date } = {}): Promise<StaffHomeWeekSummaryData> {
  const [supabase, timeZone] = await Promise.all([createClient(), getOrganizationTimezoneV2()]);
  const window = buildStaffOverviewWindow("week", now, timeZone);
  const core = await readOverviewCore(supabase);
  const events = coreEvents(core, timeZone);
  const arrivalsExact = exactRows(core.activities) && exactRows(core.registrations);
  const comparisons = {
    arrivals: arrivalsExact ? aggregateStaffOverviewEvents(datedEvents(events.arrivals), window, timeZone) : null,
    assessments: arrivalsExact && exactRows(core.assessments) ? aggregateStaffOverviewEvents(datedEvents(events.assessments), window, timeZone) : null,
    enrollments: arrivalsExact && exactRows(core.courseEnrollments) && exactRows(core.memberships) && exactRows(core.enrollmentAssignments) && exactRows(core.classrooms)
      ? aggregateStaffOverviewEvents(datedEvents(events.enrollments), window, timeZone) : null,
  };
  const businessFacts = (["arrivals", "assessments", "enrollments"] as const).map((key): StaffOverviewBusinessFact => ({
    key, current: comparisons[key]?.current ?? null, previous: comparisons[key]?.previous ?? null, trend: comparisons[key]?.trend ?? null,
  }));
  const term = !core.currentTerms.error && core.currentTerms.data?.length === 1 ? core.currentTerms.data[0] : null;
  const termClassIds = new Set((core.currentClassIds.data ?? []).map(row => row.id));
  const classrooms = (core.classrooms.data ?? []).filter(row => termClassIds.has(row.id) && !row.archived_at && !row.trashed_at);
  const capacityAvailable = Boolean(term) && exactRows(core.currentClassIds) && exactRows(core.classrooms) && exactRows(core.memberships);
  const capacityTotals = capacityAvailable ? summarizeClassroomCapacity(classrooms.map(classroom => ({
    classroomId: classroom.id, grade: classroom.grade, classroomCapacity: classroom.capacity,
    enrolledSeats: (core.memberships.data ?? []).filter(row => row.status === "active" && row.classroom_id === classroom.id).length,
  }))) : null;
  return { businessFacts, snapshot: {
    activeClasses: term && exactRows(core.classrooms) && exactRows(core.currentClassIds) ? classrooms.length : null,
    remainingSeats: capacityTotals?.remainingSeats ?? null,
  } };
}

export async function getStaffOverviewData({
  grain,
  now = new Date(),
  date,
  detail,
  selectedSupportIds = [],
}: {
  grain: StaffOverviewGrain;
  now?: Date;
  date?: string;
  detail?: OverviewDetailQuery;
  selectedSupportIds?: string[];
}): Promise<StaffOverviewData> {
  const sources = overviewReadSources(detail);
  const read = overviewReader(sources);
  const [supabase, timeZone] = await Promise.all([createClient(), getOrganizationTimezoneV2()]);
  const window = buildStaffOverviewWindow(grain, now, timeZone, date);
  const rangeStart = window.previousStart.toISOString();
  const rangeEnd = window.currentCutoff.toISOString();
  const activeLeadStates = ["unassigned", "uncontacted", "contacted", "nurture", "intent_confirmed"];
  const activeInvitationStates = [
    "coordinating_time",
    "awaiting_teacher",
    "awaiting_parent",
    "confirmed",
    "waiting_activity",
  ];

  const [core, acquisitionSourcesResult, leadSubmissionsResult, leadDirectoryResult, communicationsResult, invitationEventsResult,
    invitationThreadsResult, assignmentsResult, leadActionsResult, supportTasksResult, profilesResult,
    staffRoleMembersResult, opportunitiesResult, operationalLeadsResult] = await Promise.all([
    readOverviewCore(supabase, sources),
    sources.has("acquisitionSources") ? readOverviewAcquisitions(supabase) : Promise.resolve({ data: [], error: null }),
    read<OverviewLeadSubmission>("leadSubmissions", () => supabase.from("lead_source_records").select("id,lead_id,submitted_at")),
    read<LeadDirectoryRow>("leads", () => supabase.from("leads").select("id,owner_id,status,student_id,created_at,source_record_id")),
    read<CommunicationRow>("communications", () => supabase.from("business_lead_communications" as "lead_communications").select("id,lead_id,occurred_at,occurred_on,outcome,owner_id_at_contact,recorded_by,source_record_id")),
    read<InvitationEventRow>("invitationEvents", () => supabase.from("lead_invitation_events")
      .select("invitation_id,occurred_at,to_state,lead_invitation_threads(owner_id_at_open,assessor_id)")
      .eq("to_state", "confirmed").gte("occurred_at", rangeStart).lt("occurred_at", rangeEnd)),
    read<InvitationThreadRow>("invitationThreads", () => supabase.from("lead_invitation_threads")
      .select("id,activity_id,lead_id,kind,state,owner_id_at_open,assessor_id,scheduled_at,closed_at,created_at,updated_at")),
    read<AssignmentRow>("assignments", () => supabase.from("classroom_staff_assignments")
      .select("classroom_id,user_id,responsibility,profiles!classroom_staff_assignments_user_id_fkey(display_name)"), ["classroom_id", "user_id", "responsibility"]),
    read<LeadActionRow>("leadActions", () => supabase.from("lead_next_actions").select("lead_id,due_at").eq("status", "open").neq("kind", "initial_contact")),
    read<SupportTaskRow>("supportTasks", () => supabase.from("class_support_tasks").select("id,assigned_to,classroom_id,student_id,due_at,note").eq("status", "pending")),
    read<ProfileRow>("profiles", () => supabase.from("profiles").select("id,display_name,role,is_active").in("role", ["staff", "admin"]).eq("is_active", true)),
    read<StaffRoleMemberRow>("staffRoleMembers", () => supabase.from("staff_role_members")
      .select("user_id,staff_roles!staff_role_members_role_id_fkey(key)"), ["user_id", "role_id"]),
    read<{ id: string; owner_id: string | null }>("opportunities", () => supabase.from("course_opportunities").select("id,owner_id")),
    read<{ id: string }>("operationalLeads", () => supabase.from("operational_leads" as "leads").select("id")),
  ]);

  const unavailable = new Set<StaffOverviewSourceKey>();
  const truncated = new Set<StaffOverviewSourceKey>();
  function rows<T>(result: QueryRowsResult<T>, source: StaffOverviewSourceKey): T[] {
    if (result.error) {
      unavailable.add(source);
      return [];
    }
    const values = result.data ?? [];
    if (values.length >= READ_LIMIT) truncated.add(source);
    return values;
  }

  const acquisitionSources = acquisitionSourcesResult.data ?? [];
  const leadSubmissions = leadSubmissionsResult.data ?? [];
  const leadDirectory = rows(leadDirectoryResult, "leads");
  // 原始来源沿用管理员 RLS；当前身份无法读取时，获客统计明确显示不可用。
  const acquisitionReadable = !acquisitionSourcesResult.error && !leadSubmissionsResult.error
    && !(acquisitionSources.length === 0 && leadDirectory.some(row => row.source_record_id));
  const acquisitionAvailable = acquisitionReadable && exactRows(acquisitionSourcesResult) && exactRows(leadSubmissionsResult);
  const operationalLeadIds = new Set((operationalLeadsResult.data ?? []).map(row => row.id));
  const openLeads = leadDirectory.filter((row) => operationalLeadIds.has(row.id) && activeLeadStates.includes(row.status));
  const communications = rows(communicationsResult, "communications");
  const invitationEvents = rows(invitationEventsResult, "invitations");
  const invitationThreads = rows(invitationThreadsResult, "invitations");
  const activeInvitationThreads = invitationThreads.filter((row) => activeInvitationStates.includes(row.state));
  const activities = rows(core.activities, "activities");
  const registrations = rows(core.registrations, "activities");
  const assessments = rows(core.assessments, "assessments");
  const courseEnrollments = rows(core.courseEnrollments, "enrollments");
  const memberships = rows(core.memberships, "enrollments");
  rows(core.enrollmentAssignments, "enrollments");
  const allClassrooms = rows(core.classrooms, "classrooms");
  const term = !core.currentTerms.error && core.currentTerms.data?.length === 1 ? core.currentTerms.data[0] : null;
  if (!term) unavailable.add("classrooms");
  const termClassIds = new Set(rows(core.currentClassIds, "classrooms").map(row => row.id));
  const classrooms = allClassrooms.filter(row => termClassIds.has(row.id) && !row.archived_at && !row.trashed_at);
  const activeEnrollments = memberships.filter(row => row.status === "active");
  const assignments = rows(assignmentsResult, "staffAssignments");
  const leadActions = rows(leadActionsResult, "leads").filter(row => operationalLeadIds.has(row.lead_id));
  const supportTasks = rows(supportTasksResult, "supportTasks");
  const profiles = rows(profilesResult, "staffDirectory");
  const staffRoleMembers = rows(staffRoleMembersResult, "staffDirectory");
  const opportunities = rows(opportunitiesResult, "enrollments");
  const sourceEvents = coreEvents(core, timeZone);
  const assessmentRefs = assessments;
  const activityById = new Map(activities.map(row => [row.id, row]));
  const attended = registrations.filter(row => row.status === "attended" && row.record_state === "current"
    && activityById.get(row.activity_id)?.record_state === "current");
  const sourceExact = (source: StaffOverviewSourceKey) => !unavailable.has(source) && !truncated.has(source);

  const leadById = new Map(leadDirectory.map((row) => [row.id, row]));
  const leadsByStudent = new Map<string, LeadDirectoryRow[]>();
  for (const lead of leadDirectory) {
    if (!lead.student_id) continue;
    const values = leadsByStudent.get(lead.student_id) ?? [];
    values.push(lead);
    leadsByStudent.set(lead.student_id, values);
  }
  for (const values of leadsByStudent.values()) {
    values.sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
  }

  const invitationThreadsByStudent = new Map<string, InvitationThreadRow[]>();
  const invitationThreadsByActivityStudent = new Map<string, InvitationThreadRow[]>();
  for (const thread of invitationThreads) {
    const studentId = leadById.get(thread.lead_id)?.student_id;
    if (!studentId) continue;
    const studentValues = invitationThreadsByStudent.get(studentId) ?? [];
    studentValues.push(thread);
    invitationThreadsByStudent.set(studentId, studentValues);
    if (thread.activity_id) {
      const key = `${thread.activity_id}:${studentId}`;
      const activityValues = invitationThreadsByActivityStudent.get(key) ?? [];
      activityValues.push(thread);
      invitationThreadsByActivityStudent.set(key, activityValues);
    }
  }
  for (const values of invitationThreadsByStudent.values()) {
    values.sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
  }
  for (const values of invitationThreadsByActivityStudent.values()) {
    values.sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
  }

  const latestLeadOwner = (studentId: string, before: string): string | null => {
    const cutoff = new Date(before).getTime();
    return leadsByStudent.get(studentId)?.find((lead) => (
      new Date(lead.created_at).getTime() <= cutoff && lead.owner_id !== null
    ))?.owner_id ?? leadsByStudent.get(studentId)?.find(lead => lead.source_record_id && lead.owner_id)?.owner_id ?? null;
  };
  const supportOwnerForActivity = (activityId: string, studentId: string, at: string): string | null => {
    const exactOwner = invitationThreadsByActivityStudent.get(`${activityId}:${studentId}`)
      ?.find((thread) => thread.owner_id_at_open !== null)?.owner_id_at_open;
    return exactOwner ?? latestLeadOwner(studentId, at);
  };
  const supportOwnerForEnrollment = (studentId: string, at: string): string | null => {
    const cutoff = new Date(at).getTime();
    const invitationOwner = invitationThreadsByStudent.get(studentId)?.find((thread) => (
      new Date(thread.created_at).getTime() <= cutoff && thread.owner_id_at_open !== null
    ))?.owner_id_at_open;
    return invitationOwner ?? latestLeadOwner(studentId, at);
  };

  const sourceStaffNames = new Map<string, string>();
  const sourceStaff = (name: string) => {
    const accountId = resolveSourceStaffId(name, profiles);
    if (!name || accountId) return accountId;
    // 来源署名可以参与统计和展示选择；此键只用于总览，不创建账号或授予岗位。
    const displayId = `source-staff:${encodeURIComponent(name)}`;
    sourceStaffNames.set(displayId, name);
    return displayId;
  };
  const sourceSupport = new Map(activities.map(activity => [activity.id, sourceStaff(sourceStaffLabel(activity.remark, "学服老师"))]));
  const sourceTeachers = new Map(activities.map(activity => [activity.id, sourceStaff(sourceStaffLabel(activity.remark, "学科老师"))]));
  const personForEvent = (event: { activityId: string | null; studentId: string | null; leadId: string | null; at: string }) => {
    const directOwner = event.activityId ? sourceSupport.get(event.activityId) : null;
    const linkedLead = event.leadId ? leadById.get(event.leadId) : null;
    const studentId = event.studentId ?? linkedLead?.student_id;
    return directOwner ?? linkedLead?.owner_id ?? (studentId && event.activityId
      ? supportOwnerForActivity(event.activityId, studentId, event.at) : studentId ? latestLeadOwner(studentId, event.at) : null);
  };
  const subjectForEvent = (event: { studentId: string | null; leadId: string | null; id: string }) =>
    overviewSubjectKey(event.studentId, event.leadId, event.leadId ? leadById.get(event.leadId)?.student_id ?? null : null, event.id);
  const assessorsByRegistrationId = new Map<string, Set<string>>();
  for (const assessment of assessmentRefs) {
    if (!assessment.assessed_by) continue;
    const values = assessorsByRegistrationId.get(assessment.activity_registration_id) ?? new Set<string>();
    values.add(assessment.assessed_by);
    assessorsByRegistrationId.set(assessment.activity_registration_id, values);
  }
  for (const registration of registrations) {
    if (!registration.source_record_id) continue;
    if (assessorsByRegistrationId.get(registration.id)?.size) continue;
    const teacherId = sourceTeachers.get(registration.activity_id);
    if (teacherId) assessorsByRegistrationId.set(registration.id, new Set([teacherId]));
  }
  const sourceLeadEvents = buildOverviewAcquisitions({
    sources: acquisitionSources, leads: leadDirectory, submissions: leadSubmissions,
    sourceLinks: [...communications, ...registrations, ...assessments],
  }, timeZone);
  const leadEvents = datedEvents(sourceLeadEvents);
  const sourceContactEvents = communications.filter(row => row.outcome === "connected").map(row => ({
    id: row.id, at: overviewFactInstant(row.occurred_at, row.occurred_on, timeZone),
    personId: row.owner_id_at_contact ?? (row.source_record_id ? row.recorded_by ?? leadById.get(row.lead_id)?.owner_id ?? null : null),
  }));
  const contactEvents = datedEvents(sourceContactEvents);
  const sourceInvitationEvents = registrations.filter(row => row.source_record_id && activityById.has(row.activity_id) && !activityById.get(row.activity_id)?.source_invitation_id)
    .map(row => ({ id: row.source_record_id!, at: overviewFactInstant(null, row.registered_on, timeZone),
      activityId: row.activity_id, studentId: row.student_id, leadId: row.lead_id }));
  const invitationFactEvents = [
    ...invitationEvents.map(row => ({ id: row.invitation_id, at: row.occurred_at, personId: row.lead_invitation_threads?.owner_id_at_open ?? null })),
    ...datedEvents(sourceInvitationEvents).map(row => ({ ...row, personId: personForEvent(row) })),
  ];
  const arrivalEvents = datedEvents(sourceEvents.arrivals).map(row => ({ ...row, studentId: subjectForEvent(row), personId: personForEvent(row) }));
  const assessmentEvents = datedEvents(sourceEvents.assessments).map(row => ({ ...row, studentId: subjectForEvent(row), personId: personForEvent(row) }));
  const opportunityOwner = new Map(opportunities.map(row => [row.id, row.owner_id]));
  const enrollmentOwner = new Map(courseEnrollments.map(row => [row.id, row.opportunity_id ? opportunityOwner.get(row.opportunity_id) : null]));
  const enrollmentEvents = datedEvents(sourceEvents.enrollments).map(row => ({
    ...row, studentId: subjectForEvent(row),
    personId: enrollmentOwner.get(row.id) ?? personForEvent(row) ?? (row.studentId ? supportOwnerForEnrollment(row.studentId, row.at) : null),
  }));
  const missingDateCounts: Partial<Record<StaffOverviewMetric, number>> = {
    leads: sourceLeadEvents.filter(row => !row.at).length,
    contacts: sourceContactEvents.filter(row => !row.at).length,
    invitations: new Set(sourceInvitationEvents.filter(row => !row.at).map(row => row.id)).size,
    arrivals: sourceEvents.arrivals.filter(row => !row.at).length,
    assessments: sourceEvents.assessments.filter(row => !row.at).length,
    enrollments: sourceEvents.enrollments.filter(row => !row.at).length,
  };

  const comparisonByMetric: Record<StaffOverviewMetric, StaffOverviewComparison | null> = {
    leads: !sourceExact("leads") || !acquisitionAvailable ? null : aggregateStaffOverviewEvents(leadEvents, window, timeZone),
    contacts: !sourceExact("communications") ? null : aggregateStaffOverviewEvents(contactEvents, window, timeZone),
    invitations: !sourceExact("invitations") || !sourceExact("activities")
      ? null
      : aggregateStaffOverviewEvents(invitationFactEvents, window, timeZone, true),
    arrivals: !sourceExact("activities") ? null : aggregateStaffOverviewEvents(arrivalEvents, window, timeZone),
    assessments: !sourceExact("assessments") || !sourceExact("activities") ? null : aggregateStaffOverviewEvents(assessmentEvents, window, timeZone),
    enrollments: !sourceExact("enrollments") || !sourceExact("classrooms") || !sourceExact("activities") ? null : aggregateStaffOverviewEvents(enrollmentEvents, window, timeZone),
  };

  const businessFacts = (["leads", "contacts", "invitations", "arrivals", "assessments", "enrollments"] as const)
    .map((key): StaffOverviewBusinessFact => ({
      key,
      current: comparisonByMetric[key]?.current ?? null,
      previous: comparisonByMetric[key]?.previous ?? null,
      trend: comparisonByMetric[key]?.trend ?? null,
    }));

  const activeClassIds = new Set(classrooms.map((row) => row.id));
  const scopedActiveEnrollments = activeEnrollments.filter((row) => activeClassIds.has(row.classroom_id));
  const enrollmentsByClassroom = new Map<string, number>();
  for (const enrollment of scopedActiveEnrollments) {
    enrollmentsByClassroom.set(enrollment.classroom_id, (enrollmentsByClassroom.get(enrollment.classroom_id) ?? 0) + 1);
  }
  const capacityInputs: ClassroomCapacityInput[] = classrooms.map((classroom) => ({
    classroomId: classroom.id,
    grade: classroom.grade,
    classroomCapacity: classroom.capacity,
    enrolledSeats: enrollmentsByClassroom.get(classroom.id) ?? 0,
  }));
  const capacityAvailable = sourceExact("classrooms") && sourceExact("enrollments");
  const capacityTotals = capacityAvailable ? summarizeClassroomCapacity(capacityInputs) : emptyCapacityTotals();
  const snapshot: StaffOverviewSnapshot = {
    activeStudents: capacityAvailable ? new Set(scopedActiveEnrollments.map((row) => row.student_id)).size : null,
    activeClasses: sourceExact("classrooms") ? classrooms.length : null,
    enrolledSeats: capacityAvailable ? scopedActiveEnrollments.length : null,
    healthyDelta: capacityAvailable ? capacityTotals.healthyDelta : null,
    remainingSeats: capacityAvailable ? capacityTotals.remainingSeats : null,
  };

  const capacityByGrade: StaffOverviewCapacityRow[] = [];
  if (capacityAvailable) {
    const gradeGroups = new Map<string, ClassroomCapacityInput[]>();
    for (const classroom of capacityInputs) {
      const key = classroom.grade === null ? "unknown" : String(classroom.grade);
      const group = gradeGroups.get(key) ?? [];
      group.push(classroom);
      gradeGroups.set(key, group);
    }
    for (const [key, group] of gradeGroups) {
      capacityByGrade.push({ key, grade: group[0]?.grade ?? null, ...summarizeClassroomCapacity(group) });
    }
    capacityByGrade.sort((a, b) => (a.grade ?? Number.MAX_SAFE_INTEGER) - (b.grade ?? Number.MAX_SAFE_INTEGER));
  }

  const profileNames = new Map(profiles.map((row) => [row.id, row.display_name]));
  for (const assignment of assignments) {
    if (assignment.profiles?.display_name && !profileNames.has(assignment.user_id)) {
      profileNames.set(assignment.user_id, assignment.profiles.display_name);
    }
  }
  const displayName = (userId: string) => profileNames.get(userId) || sourceStaffNames.get(userId) || userId.slice(0, 8);
  const classroomRows: OverviewClassroomOccupancy[] = classrooms.map(classroom => ({
    id: classroom.id,
    name: classroom.name ?? "",
    grade: classroom.grade,
    teacherNames: sourceExact("staffAssignments") ? Array.from(new Set(assignments
      .filter(assignment => assignment.classroom_id === classroom.id && assignment.responsibility === "primary_teacher")
      .map(assignment => displayName(assignment.user_id)))) : [],
    enrolledSeats: capacityAvailable ? enrollmentsByClassroom.get(classroom.id) ?? 0 : null,
    ...resolveClassroomCapacityPolicy(classroom.grade, classroom.capacity),
  }));

  const supportAttributedEvents: Record<StaffOverviewMetric, Array<{ id: string; at: string; personId: string | null }>> = {
    leads: leadEvents,
    contacts: contactEvents,
    invitations: invitationFactEvents,
    arrivals: arrivalEvents,
    assessments: assessmentEvents,
    enrollments: enrollmentEvents,
  };
  const supportMetricSources: Record<StaffOverviewMetric, StaffOverviewSourceKey[]> = {
    leads: ["leads"],
    contacts: ["communications"],
    invitations: ["invitations", "activities", "leads", "staffDirectory"],
    arrivals: ["activities", "invitations", "leads", "staffDirectory"],
    assessments: ["assessments", "activities", "invitations", "leads", "staffDirectory"],
    enrollments: ["enrollments", "activities", "invitations", "leads", "classrooms", "staffDirectory"],
  };
  const supportMetricExact = (metric: StaffOverviewMetric) => supportMetricSources[metric].every(sourceExact)
    && (metric !== "leads" || acquisitionAvailable);
  const personKey = (userId: string | null) => userId ?? "__unassigned__";
  const supportComparisons = new Map<StaffOverviewMetric, Map<string, StaffOverviewPersonMetric>>();
  const supportIds = new Set<string>();
  staffRoleMembers.forEach((row) => { if (row.staff_roles?.key === "sales") supportIds.add(row.user_id); });
  assignments.forEach((row) => { if (row.responsibility === "learning_support") supportIds.add(row.user_id); });
  supportTasks.forEach((row) => { if (row.assigned_to) supportIds.add(row.assigned_to); });
  let hasUnassignedSupportFacts = false;

  for (const metricKey of STAFF_OVERVIEW_METRICS) {
    const comparisons = aggregateStaffOverviewEventsByPerson(
      supportAttributedEvents[metricKey],
      window,
      metricKey === "invitations",
    );
    const byPerson = new Map<string, StaffOverviewPersonMetric>();
    for (const comparison of comparisons) {
      byPerson.set(personKey(comparison.personId), {
        current: comparison.current,
        previous: comparison.previous,
      });
      if (comparison.personId) supportIds.add(comparison.personId);
      else hasUnassignedSupportFacts = true;
    }
    supportComparisons.set(metricKey, byPerson);
  }

  const supportFunnelRows: StaffOverviewSupportFunnelRow[] = [
    ...Array.from(supportIds, (userId): StaffOverviewSupportFunnelRow => ({
      key: userId,
      userId,
      name: displayName(userId),
      metrics: Object.fromEntries(STAFF_OVERVIEW_METRICS.map((metricKey) => [
        metricKey,
        supportMetricExact(metricKey)
          ? supportComparisons.get(metricKey)?.get(personKey(userId)) ?? { current: 0, previous: 0 }
          : { current: null, previous: null },
      ])) as Record<StaffOverviewMetric, StaffOverviewPersonMetric>,
    })),
    ...(hasUnassignedSupportFacts ? [{
      key: "__unassigned__",
      userId: null,
      name: "",
      metrics: Object.fromEntries(STAFF_OVERVIEW_METRICS.map((metricKey) => [
        metricKey,
        supportMetricExact(metricKey)
          ? supportComparisons.get(metricKey)?.get(personKey(null)) ?? { current: 0, previous: 0 }
          : { current: null, previous: null },
      ])) as Record<StaffOverviewMetric, StaffOverviewPersonMetric>,
    }] : []),
  ].sort((left, right) => {
    const total = (row: StaffOverviewSupportFunnelRow) => STAFF_OVERVIEW_METRICS
      .reduce((sum, metricKey) => sum + (row.metrics[metricKey].current ?? 0), 0);
    return total(right) - total(left) || left.name.localeCompare(right.name);
  });

  const primaryClassIdsByTeacher = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    if (assignment.responsibility !== "primary_teacher" || !activeClassIds.has(assignment.classroom_id)) continue;
    const values = primaryClassIdsByTeacher.get(assignment.user_id) ?? new Set<string>();
    values.add(assignment.classroom_id);
    primaryClassIdsByTeacher.set(assignment.user_id, values);
  }
  const teacherIds = new Set<string>(primaryClassIdsByTeacher.keys());
  staffRoleMembers.forEach((row) => { if (row.staff_roles?.key === "teacher") teacherIds.add(row.user_id); });
  assessments.forEach((row) => { if (row.assessed_by) teacherIds.add(row.assessed_by); });
  invitationThreads.forEach((row) => { if (row.assessor_id) teacherIds.add(row.assessor_id); });

  const capacityByClassroomId = new Map(capacityInputs.map((row) => [row.classroomId, row]));
  const teacherRows = Array.from(teacherIds, (userId): StaffOverviewTeacherRow => {
    const classIds = primaryClassIdsByTeacher.get(userId) ?? new Set<string>();
    const teacherCapacity = summarizeClassroomCapacity(Array.from(classIds)
      .map((classroomId) => capacityByClassroomId.get(classroomId))
      .filter((row): row is ClassroomCapacityInput => Boolean(row)));
    const classFactsAvailable = sourceExact("staffAssignments") && sourceExact("classrooms");
    const capacityFactsAvailable = classFactsAvailable && sourceExact("enrollments");
    return {
      userId,
      name: displayName(userId),
      classCount: classFactsAvailable ? classIds.size : null,
      fullSeats: classFactsAvailable ? teacherCapacity.fullSeats : null,
      enrolledSeats: capacityFactsAvailable ? teacherCapacity.enrolledSeats : null,
      minimumOpenGap: capacityFactsAvailable ? teacherCapacity.minimumOpenGap : null,
      healthyDelta: capacityFactsAvailable ? teacherCapacity.healthyDelta : null,
      remainingSeats: capacityFactsAvailable ? teacherCapacity.remainingSeats : null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const teacherParticipationAvailable = sourceExact("activities") && sourceExact("assessments");
  const teacherEnrollmentAvailable = teacherParticipationAvailable && sourceExact("enrollments");
  const participationEvents = [
        ...arrivalEvents.map((event) => ({
          id: event.id,
          studentId: event.studentId,
          at: event.at,
          teacherIds: Array.from(new Set((event.registrationIds ?? [event.id])
            .flatMap(id => Array.from(assessorsByRegistrationId.get(id) ?? [])))),
        })),
        ...assessmentEvents.map(event => ({
          id: event.id, studentId: event.studentId, at: event.at,
          teacherIds: Array.from(assessorsByRegistrationId.get(assessments.find(row => row.id === event.id)!.activity_registration_id) ?? []),
        })),
      ];
  const teacherOutcome = teacherParticipationAvailable
    ? summarizeTeacherParticipationOutcomes(
      participationEvents,
      enrollmentEvents,
      window,
    )
    : null;
  const unavailableMetric: StaffOverviewPersonMetric = { current: null, previous: null };
  const teacherParticipationSummary: StaffOverviewTeacherParticipationSummary = {
    participants: teacherOutcome?.totalParticipants ?? unavailableMetric,
    enrollments: teacherEnrollmentAvailable ? teacherOutcome?.totalEnrollments ?? unavailableMetric : unavailableMetric,
    unattributedParticipants: teacherOutcome?.unattributedParticipants ?? unavailableMetric,
  };
  const teacherParticipationRows: StaffOverviewTeacherParticipationRow[] = (teacherOutcome?.teachers ?? [])
    .map((row) => ({
      userId: row.teacherId,
      name: displayName(row.teacherId),
      participants: row.participants,
      enrollments: teacherEnrollmentAvailable ? row.enrollments : unavailableMetric,
    }))
    .sort((left, right) => (
      (right.participants.current ?? 0) - (left.participants.current ?? 0)
      || (right.enrollments.current ?? 0) - (left.enrollments.current ?? 0)
      || left.name.localeCompare(right.name)
    ));

  const assessedRegistrationIds = new Set(assessmentRefs.map((row) => row.activity_registration_id));
  const pendingFacts: StaffOverviewPendingFact[] = [
    {
      key: "unassignedLeads",
      value: !sourceExact("leads") || !exactRows(operationalLeadsResult) ? null : openLeads.filter((row) => row.owner_id === null || row.status === "unassigned").length,
      href: "/dashboard/followups/leads?ownership=unassigned",
    },
    {
      key: "uncontactedLeads",
      value: !sourceExact("leads") || !exactRows(operationalLeadsResult) ? null : openLeads.filter((row) => row.status === "uncontacted").length,
      href: "/dashboard/followups/leads?status=uncontacted",
    },
    {
      key: "overdueLeadActions",
      value: !sourceExact("leads") || !exactRows(operationalLeadsResult) ? null : leadActions.filter((row) => new Date(row.due_at) < now).length,
      href: "/dashboard/followups/leads",
    },
    {
      key: "awaitingTeacher",
      value: !sourceExact("invitations") ? null : activeInvitationThreads.filter((row) => row.state === "awaiting_teacher").length,
      href: "/dashboard/followups/communication?state=awaiting_teacher",
    },
    {
      key: "awaitingParent",
      value: !sourceExact("invitations") ? null : activeInvitationThreads.filter((row) => row.state === "awaiting_parent").length,
      href: "/dashboard/followups/communication?state=awaiting_parent",
    },
    {
      key: "unassessedArrivals",
      value: !sourceExact("activities") || !sourceExact("assessments")
        ? null
        : attended.filter((row) => !assessedRegistrationIds.has(row.id)).length,
      href: "/dashboard/activities",
    },
    {
      key: "pendingSupportTasks",
      value: !sourceExact("supportTasks") ? null : supportTasks.length,
      href: "/dashboard/classes",
    },
  ];

  let detailResult: StaffOverviewData["detail"];
  if (detail) {
    const subject = (key: string): Pick<OverviewDetailRecord, "studentId" | "leadId"> => key.startsWith("lead:")
      ? { leadId: key.slice(5) } : key.startsWith("record:") ? {} : { studentId: key };
    const sourceById = new Map(acquisitionSources.map(row => [row.id, row]));
    const registrationById = new Map(registrations.map(row => [row.id, row]));
    const detailRef = (metric: StaffOverviewMetric, id: string): OverviewDetailRecord => {
      if (metric === "leads") {
        const source = sourceById.get(id);
        const lead = leadById.get(id.replace(/^submission:/, "")) ?? leadDirectory.find(row => row.source_record_id === id);
        return { id, leadId: lead?.id ?? source?.lead_id, studentId: lead?.student_id, sourceId: source?.id,
          name: source?.record_data.cells?.find(cell => cell.fieldName === "学员姓名")?.text };
      }
      if (metric === "contacts") {
        const row = communications.find(row => row.id === id);
        return { id, leadId: row?.lead_id, sourceId: row?.source_record_id };
      }
      if (metric === "invitations") {
        const row = registrations.find(row => row.source_record_id === id);
        return { id, leadId: row?.lead_id ?? invitationThreads.find(row => row.id === id)?.lead_id,
          studentId: row?.student_id, sourceId: row?.source_record_id };
      }
      const event = sourceEvents[metric].find(row => row.id === id);
      const registration = registrationById.get(id.replace(/^source-enrollment:/, ""));
      const assessment = assessments.find(row => row.id === id);
      return { id, studentId: event?.studentId, leadId: event?.leadId,
        sourceId: registration?.source_record_id ?? assessment?.source_record_id ?? courseEnrollments.find(row => row.id === id)?.source_record_id };
    };
    let records: OverviewDetailRecord[] = [];
    let available = false;
    if ((detail.kind === "business" || detail.kind === "support") && STAFF_OVERVIEW_METRICS.includes(detail.metric as StaffOverviewMetric)) {
      const metric = detail.metric as StaffOverviewMetric;
      available = detail.kind === "support" ? supportMetricExact(metric) : comparisonByMetric[metric] !== null;
      records = selectOverviewDetailEvents(supportAttributedEvents[metric], window, detail, selectedSupportIds)
        .map((event, index) => ({ ...detailRef(metric, event.id), id: `${event.id}:${index}`, at: event.at,
          person: event.personId ? displayName(event.personId) : undefined }));
    } else if (detail.kind === "participation") {
      available = detail.metric === "enrollments" || detail.metric === "conversion" ? teacherEnrollmentAvailable : teacherParticipationAvailable;
      records = selectOverviewParticipants(participationEvents, enrollmentEvents, window, detail).map(row => {
        const event = [...arrivalEvents, ...assessmentEvents].find(event => event.studentId === row.studentId);
        const ref = event ? detailRef(arrivalEvents.includes(event) ? "arrivals" : "assessments", event.id) : {};
        return { ...ref, ...subject(row.studentId), id: row.studentId, at: row.at,
          values: [{ label: "enrollmentOutcome", value: teacherEnrollmentAvailable ? row.enrolled ? "enrolled" : "notEnrolled" : "unknown" }] };
      });
    } else if (detail.kind === "capacity") {
      available = capacityAvailable && (detail.group !== "teacher" || sourceExact("staffAssignments"));
      const selectedClasses = classroomRows.filter(row => !detail.scope || (detail.group === "teacher"
        ? primaryClassIdsByTeacher.get(detail.scope)?.has(row.id)
        : detail.group === "grade" ? (row.grade === null ? "unknown" : String(row.grade)) === detail.scope : row.id === detail.scope));
      if (detail.metric === "activeStudents" || detail.metric === "enrolledSeats") {
        const ids = new Set(selectedClasses.map(row => row.id));
        const seen = new Set<string>();
        records = scopedActiveEnrollments.filter(row => ids.has(row.classroom_id)).flatMap(row => {
          if (detail.metric === "activeStudents" && seen.has(row.student_id)) return [];
          seen.add(row.student_id);
          return [{ id: row.id, studentId: row.student_id, at: row.joined_at,
            values: [{ label: "classes", value: selectedClasses.filter(item => scopedActiveEnrollments.some(member => member.student_id === row.student_id && member.classroom_id === item.id)).map(item => item.name).join(" · ") }] }];
        });
      } else records = selectedClasses.map(row => ({ id: row.id, name: row.name, person: row.teacherNames.join(" · "), href: `/dashboard/classes/${row.id}`,
        values: [
          { label: "enrolledSeats", value: String(row.enrolledSeats ?? "—") },
          { label: "minimum", value: String(row.minimumOpen) },
          { label: "healthy", value: String(row.healthy ?? "—") },
          { label: "full", value: String(row.full ?? "—") },
          { label: "minimumOpenGap", value: String(Math.max(0, row.minimumOpen - (row.enrolledSeats ?? 0))) },
          { label: "healthyDelta", value: row.healthy === null ? "—" : String((row.enrolledSeats ?? 0) - row.healthy) },
          { label: "remainingSeats", value: row.full === null ? "—" : String(Math.max(0, row.full - (row.enrolledSeats ?? 0))) },
        ] }));
    } else if (detail.kind === "pending") {
      available = pendingFacts.find(row => row.key === detail.metric)?.value != null;
      if (detail.metric === "unassignedLeads" || detail.metric === "uncontactedLeads") records = openLeads
        .filter(row => detail.metric === "unassignedLeads" ? row.owner_id === null || row.status === "unassigned" : row.status === "uncontacted")
        .map(row => ({ id: row.id, leadId: row.id, studentId: row.student_id, at: row.created_at, person: row.owner_id ? displayName(row.owner_id) : undefined }));
      if (detail.metric === "overdueLeadActions") records = leadActions.filter(row => new Date(row.due_at) < now)
        .map((row, index) => ({ id: `${row.lead_id}:${index}`, leadId: row.lead_id, at: row.due_at }));
      if (detail.metric === "awaitingTeacher" || detail.metric === "awaitingParent") records = activeInvitationThreads
        .filter(row => row.state === (detail.metric === "awaitingTeacher" ? "awaiting_teacher" : "awaiting_parent"))
        .map(row => ({ id: row.id, leadId: row.lead_id, at: row.scheduled_at ?? undefined, person: row.owner_id_at_open ? displayName(row.owner_id_at_open) : undefined }));
      if (detail.metric === "unassessedArrivals") records = attended.filter(row => !assessedRegistrationIds.has(row.id))
        .map(row => ({ id: row.id, studentId: row.student_id, leadId: row.lead_id, sourceId: row.source_record_id }));
      if (detail.metric === "pendingSupportTasks") records = supportTasks.map(row => ({ id: row.id, studentId: row.student_id,
        name: row.note || undefined, at: row.due_at ?? undefined, person: row.assigned_to ? displayName(row.assigned_to) : undefined,
        href: `/dashboard/classes/${row.classroom_id}` }));
    }
    detailResult = { available, records: available ? records : [] };
  }
  if (!acquisitionReadable) unavailable.add("leads");
  else if (!acquisitionAvailable) truncated.add("leads");
  return {
    ...(detailResult ? { detail: detailResult } : {}),
    currentTermName: term?.name ?? null,
    missingDateCounts,
    generatedAt: now.toISOString(),
    timeZone,
    grain,
    isComplete: window.isComplete,
    currentStart: window.currentStart.toISOString(),
    currentEnd: window.currentEnd.toISOString(),
    currentCutoff: window.currentCutoff.toISOString(),
    previousStart: window.previousStart.toISOString(),
    previousCutoff: window.previousCutoff.toISOString(),
    snapshot,
    businessFacts,
    pendingFacts,
    supportFunnelRows,
    supportDirectory: [...profiles.map(person => ({ userId: person.id, name: displayName(person.id) })),
      ...Array.from(sourceStaffNames, ([userId, name]) => ({ userId, name }))],
    teacherParticipationRows,
    teacherParticipationSummary,
    capacityByGrade,
    classroomRows,
    capacityAvailable,
    teacherRows,
    unavailableSources: Array.from(unavailable),
    truncatedSources: Array.from(truncated),
  };
}

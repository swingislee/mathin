import "server-only";

import { getOrganizationTimezoneV2 } from "@/features/school/organization-locations";
import { createClient } from "@/lib/supabase/server";
import {
  aggregateStaffOverviewEvents,
  aggregateStaffOverviewEventsByPerson,
  buildStaffOverviewWindow,
  STAFF_OVERVIEW_METRICS,
  summarizeClassroomCapacity,
  summarizeTeacherParticipationOutcomes,
  type ClassroomCapacityInput,
  type ClassroomCapacityTotals,
  type StaffOverviewComparison,
  type StaffOverviewGrain,
  type StaffOverviewMetric,
  type StaffOverviewTrendPoint,
} from "./staff-overview-contract";

const READ_LIMIT = 10_000;

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
  generatedAt: string;
  timeZone: string;
  grain: StaffOverviewGrain;
  currentStart: string;
  currentCutoff: string;
  previousStart: string;
  previousCutoff: string;
  snapshot: StaffOverviewSnapshot;
  businessFacts: StaffOverviewBusinessFact[];
  pendingFacts: StaffOverviewPendingFact[];
  supportFunnelRows: StaffOverviewSupportFunnelRow[];
  teacherParticipationRows: StaffOverviewTeacherParticipationRow[];
  teacherParticipationSummary: StaffOverviewTeacherParticipationSummary;
  capacityByGrade: StaffOverviewCapacityRow[];
  capacityAvailable: boolean;
  teacherRows: StaffOverviewTeacherRow[];
  unavailableSources: StaffOverviewSourceKey[];
  truncatedSources: StaffOverviewSourceKey[];
}

export interface StaffHomeWeekSummaryData {
  businessFacts: StaffOverviewBusinessFact[];
  snapshot: Pick<StaffOverviewSnapshot, "activeClasses" | "remainingSeats">;
}

interface PeriodLeadRow {
  id: string;
  created_at: string;
  owner_id: string | null;
}

interface LeadDirectoryRow {
  id: string;
  owner_id: string | null;
  status: string;
  student_id: string | null;
  created_at: string;
}

interface CommunicationRow {
  id: string;
  occurred_at: string;
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

interface ActivityPeriodRow {
  id: string;
  scheduled_at: string;
  activity_registrations: Array<{
    id: string;
    status: string;
    student_id: string;
  }>;
}

interface AssessmentPeriodRow {
  id: string;
  activity_registration_id: string;
  assessed_by: string | null;
  student_id: string;
  created_at: string;
}

interface EnrollmentPeriodRow {
  id: string;
  classroom_id: string;
  student_id: string;
  joined_at: string;
}

interface ActiveEnrollmentRow {
  classroom_id: string;
  student_id: string;
}

interface ClassroomRow {
  id: string;
  grade: number | null;
  capacity: number | null;
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
  assigned_to: string | null;
}

interface AssessmentReferenceRow {
  activity_registration_id: string;
  assessed_by: string | null;
}

interface ProfileRow {
  id: string;
  display_name: string;
}

interface StaffRoleMemberRow {
  user_id: string;
  staff_roles: { key: string } | null;
}

interface QueryRowsResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

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

/** 今日工作只读取交叉摘要需要的五类事实，避免为五个数字装载完整人员归属与待办目录。 */
export async function getStaffHomeWeekSummaryData({
  now = new Date(),
}: {
  now?: Date;
} = {}): Promise<StaffHomeWeekSummaryData> {
  const [supabase, timeZone] = await Promise.all([createClient(), getOrganizationTimezoneV2()]);
  const window = buildStaffOverviewWindow("week", now, timeZone);
  const rangeStart = window.previousStart.toISOString();
  const rangeEnd = window.currentCutoff.toISOString();
  const [activitiesResult, assessmentsResult, periodEnrollmentsResult, activeEnrollmentsResult, classroomsResult] = await Promise.all([
    supabase
      .from("activities")
      .select("id,scheduled_at,activity_registrations(id,status,student_id)")
      .is("deleted_at", null)
      .gte("scheduled_at", rangeStart)
      .lt("scheduled_at", rangeEnd)
      .limit(READ_LIMIT)
      .returns<ActivityPeriodRow[]>(),
    supabase
      .from("assessment_results")
      .select("id,activity_registration_id,assessed_by,student_id,created_at")
      .gte("created_at", rangeStart)
      .lt("created_at", rangeEnd)
      .limit(READ_LIMIT)
      .returns<AssessmentPeriodRow[]>(),
    supabase
      .from("enrollments")
      .select("id,classroom_id,student_id,joined_at")
      .gte("joined_at", rangeStart)
      .lt("joined_at", rangeEnd)
      .limit(READ_LIMIT)
      .returns<EnrollmentPeriodRow[]>(),
    supabase
      .from("enrollments")
      .select("classroom_id,student_id")
      .eq("status", "active")
      .limit(READ_LIMIT)
      .returns<ActiveEnrollmentRow[]>(),
    supabase
      .from("classrooms")
      .select("id,grade,capacity")
      .eq("purpose", "production")
      .eq("operational_status", "active")
      .is("archived_at", null)
      .is("trashed_at", null)
      .limit(READ_LIMIT)
      .returns<ClassroomRow[]>(),
  ]);

  const exact = <T,>(result: QueryRowsResult<T>) => !result.error && (result.data?.length ?? 0) < READ_LIMIT;
  const activities = activitiesResult.data ?? [];
  const assessments = assessmentsResult.data ?? [];
  const periodEnrollments = periodEnrollmentsResult.data ?? [];
  const activeEnrollments = activeEnrollmentsResult.data ?? [];
  const classrooms = classroomsResult.data ?? [];
  const comparisons: Record<"arrivals" | "assessments" | "enrollments", StaffOverviewComparison | null> = {
    arrivals: exact(activitiesResult)
      ? aggregateStaffOverviewEvents(
        activities.flatMap((activity) => activity.activity_registrations
          .filter((registration) => registration.status === "attended")
          .map((registration) => ({ id: registration.id, at: activity.scheduled_at }))),
        window,
        timeZone,
      )
      : null,
    assessments: exact(assessmentsResult)
      ? aggregateStaffOverviewEvents(
        assessments.map((assessment) => ({ id: assessment.id, at: assessment.created_at })),
        window,
        timeZone,
      )
      : null,
    enrollments: exact(periodEnrollmentsResult)
      ? aggregateStaffOverviewEvents(
        periodEnrollments.map((enrollment) => ({ id: enrollment.id, at: enrollment.joined_at })),
        window,
        timeZone,
      )
      : null,
  };
  const businessFacts = (["arrivals", "assessments", "enrollments"] as const).map((key): StaffOverviewBusinessFact => ({
    key,
    current: comparisons[key]?.current ?? null,
    previous: comparisons[key]?.previous ?? null,
    trend: comparisons[key]?.trend ?? null,
  }));

  const capacityAvailable = exact(classroomsResult) && exact(activeEnrollmentsResult);
  const activeClassIds = new Set(classrooms.map((classroom) => classroom.id));
  const enrollmentsByClassroom = new Map<string, number>();
  for (const enrollment of activeEnrollments) {
    if (!activeClassIds.has(enrollment.classroom_id)) continue;
    enrollmentsByClassroom.set(enrollment.classroom_id, (enrollmentsByClassroom.get(enrollment.classroom_id) ?? 0) + 1);
  }
  const capacityTotals = capacityAvailable
    ? summarizeClassroomCapacity(classrooms.map((classroom) => ({
      classroomId: classroom.id,
      grade: classroom.grade,
      classroomCapacity: classroom.capacity,
      enrolledSeats: enrollmentsByClassroom.get(classroom.id) ?? 0,
    })))
    : null;

  return {
    businessFacts,
    snapshot: {
      activeClasses: exact(classroomsResult) ? classrooms.length : null,
      remainingSeats: capacityTotals?.remainingSeats ?? null,
    },
  };
}

export async function getStaffOverviewData({
  grain,
  now = new Date(),
}: {
  grain: StaffOverviewGrain;
  now?: Date;
}): Promise<StaffOverviewData> {
  const [supabase, timeZone] = await Promise.all([createClient(), getOrganizationTimezoneV2()]);
  const window = buildStaffOverviewWindow(grain, now, timeZone);
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

  const [
    periodLeadsResult,
    leadDirectoryResult,
    communicationsResult,
    invitationEventsResult,
    invitationThreadsResult,
    activitiesResult,
    assessmentsResult,
    periodEnrollmentsResult,
    activeEnrollmentsResult,
    classroomsResult,
    assignmentsResult,
    leadActionsResult,
    attendedResult,
    assessmentRefsResult,
    supportTasksResult,
    profilesResult,
    staffRoleMembersResult,
  ] = await Promise.all([
    supabase.from("leads").select("id,created_at,owner_id").gte("created_at", rangeStart).lt("created_at", rangeEnd).limit(READ_LIMIT).returns<PeriodLeadRow[]>(),
    supabase.from("leads").select("id,owner_id,status,student_id,created_at").limit(READ_LIMIT).returns<LeadDirectoryRow[]>(),
    supabase.from("lead_communications").select("id,occurred_at,outcome,owner_id_at_contact").gte("occurred_at", rangeStart).lt("occurred_at", rangeEnd).limit(READ_LIMIT).returns<CommunicationRow[]>(),
    supabase
      .from("lead_invitation_events")
      .select("invitation_id,occurred_at,to_state,lead_invitation_threads(owner_id_at_open,assessor_id)")
      .eq("to_state", "confirmed")
      .gte("occurred_at", rangeStart)
      .lt("occurred_at", rangeEnd)
      .limit(READ_LIMIT)
      .returns<InvitationEventRow[]>(),
    supabase
      .from("lead_invitation_threads")
      .select("id,activity_id,lead_id,kind,state,owner_id_at_open,assessor_id,scheduled_at,closed_at,created_at,updated_at")
      .limit(READ_LIMIT)
      .returns<InvitationThreadRow[]>(),
    supabase
      .from("activities")
      .select("id,scheduled_at,activity_registrations(id,status,student_id)")
      .is("deleted_at", null)
      .gte("scheduled_at", rangeStart)
      .lt("scheduled_at", rangeEnd)
      .limit(READ_LIMIT)
      .returns<ActivityPeriodRow[]>(),
    supabase.from("assessment_results").select("id,activity_registration_id,assessed_by,student_id,created_at").gte("created_at", rangeStart).lt("created_at", rangeEnd).limit(READ_LIMIT).returns<AssessmentPeriodRow[]>(),
    supabase.from("enrollments").select("id,classroom_id,student_id,joined_at").gte("joined_at", rangeStart).lt("joined_at", rangeEnd).limit(READ_LIMIT).returns<EnrollmentPeriodRow[]>(),
    supabase.from("enrollments").select("classroom_id,student_id").eq("status", "active").limit(READ_LIMIT).returns<ActiveEnrollmentRow[]>(),
    supabase
      .from("classrooms")
      .select("id,grade,capacity")
      .eq("purpose", "production")
      .eq("operational_status", "active")
      .is("archived_at", null)
      .is("trashed_at", null)
      .limit(READ_LIMIT)
      .returns<ClassroomRow[]>(),
    supabase
      .from("classroom_staff_assignments")
      .select("classroom_id,user_id,responsibility,profiles!classroom_staff_assignments_user_id_fkey(display_name)")
      .limit(READ_LIMIT)
      .returns<AssignmentRow[]>(),
    supabase.from("lead_next_actions").select("lead_id,due_at").eq("status", "open").limit(READ_LIMIT).returns<LeadActionRow[]>(),
    supabase.from("activity_registrations").select("id").eq("status", "attended").limit(READ_LIMIT).returns<Array<{ id: string }>>(),
    supabase.from("assessment_results").select("activity_registration_id,assessed_by").limit(READ_LIMIT).returns<AssessmentReferenceRow[]>(),
    supabase.from("class_support_tasks").select("assigned_to").eq("status", "pending").limit(READ_LIMIT).returns<SupportTaskRow[]>(),
    supabase.from("profiles").select("id,display_name").in("role", ["staff", "admin"]).eq("is_active", true).limit(READ_LIMIT).returns<ProfileRow[]>(),
    supabase
      .from("staff_role_members")
      .select("user_id,staff_roles!staff_role_members_role_id_fkey(key)")
      .limit(READ_LIMIT)
      .returns<StaffRoleMemberRow[]>(),
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

  const periodLeads = rows(periodLeadsResult, "leads");
  const leadDirectory = rows(leadDirectoryResult, "leads");
  const openLeads = leadDirectory.filter((row) => activeLeadStates.includes(row.status));
  const communications = rows(communicationsResult, "communications");
  const invitationEvents = rows(invitationEventsResult, "invitations");
  const invitationThreads = rows(invitationThreadsResult, "invitations");
  const activeInvitationThreads = invitationThreads.filter((row) => activeInvitationStates.includes(row.state));
  const activities = rows(activitiesResult, "activities");
  const assessments = rows(assessmentsResult, "assessments");
  const periodEnrollments = rows(periodEnrollmentsResult, "enrollments");
  const activeEnrollments = rows(activeEnrollmentsResult, "enrollments");
  const classrooms = rows(classroomsResult, "classrooms");
  const assignments = rows(assignmentsResult, "staffAssignments");
  const leadActions = rows(leadActionsResult, "leads");
  const attended = rows(attendedResult, "activities");
  const assessmentRefs = rows(assessmentRefsResult, "assessments");
  const supportTasks = rows(supportTasksResult, "supportTasks");
  const profiles = rows(profilesResult, "staffDirectory");
  const staffRoleMembers = rows(staffRoleMembersResult, "staffDirectory");
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
    ))?.owner_id ?? null;
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

  const registrationContextById = new Map<string, { activityId: string; studentId: string; at: string }>();
  for (const activity of activities) {
    for (const registration of activity.activity_registrations) {
      registrationContextById.set(registration.id, {
        activityId: activity.id,
        studentId: registration.student_id,
        at: activity.scheduled_at,
      });
    }
  }
  const assessorsByRegistrationId = new Map<string, Set<string>>();
  for (const assessment of assessmentRefs) {
    if (!assessment.assessed_by) continue;
    const values = assessorsByRegistrationId.get(assessment.activity_registration_id) ?? new Set<string>();
    values.add(assessment.assessed_by);
    assessorsByRegistrationId.set(assessment.activity_registration_id, values);
  }

  const leadEvents = periodLeads.map((row) => ({ id: row.id, at: row.created_at, personId: row.owner_id }));
  const contactEvents = communications
    .filter((row) => row.outcome === "connected")
    .map((row) => ({ id: row.id, at: row.occurred_at, personId: row.owner_id_at_contact }));
  const invitationFactEvents = invitationEvents.map((row) => ({
    id: row.invitation_id,
    at: row.occurred_at,
    personId: row.lead_invitation_threads?.owner_id_at_open ?? null,
  }));
  const arrivalEvents = activities.flatMap((activity) => activity.activity_registrations
    .filter((registration) => registration.status === "attended")
    .map((registration) => ({
      id: registration.id,
      at: activity.scheduled_at,
      studentId: registration.student_id,
      personId: supportOwnerForActivity(activity.id, registration.student_id, activity.scheduled_at),
    })));
  const assessmentEvents = assessments.map((row) => {
    const registration = registrationContextById.get(row.activity_registration_id);
    return {
      id: row.id,
      at: row.created_at,
      studentId: row.student_id,
      personId: registration
        ? supportOwnerForActivity(registration.activityId, registration.studentId, row.created_at)
        : latestLeadOwner(row.student_id, row.created_at),
    };
  });
  const enrollmentEvents = periodEnrollments.map((row) => ({
    id: row.id,
    at: row.joined_at,
    studentId: row.student_id,
    personId: supportOwnerForEnrollment(row.student_id, row.joined_at),
  }));

  const comparisonByMetric: Record<StaffOverviewMetric, StaffOverviewComparison | null> = {
    leads: !sourceExact("leads") ? null : aggregateStaffOverviewEvents(leadEvents, window, timeZone),
    contacts: !sourceExact("communications") ? null : aggregateStaffOverviewEvents(contactEvents, window, timeZone),
    invitations: !sourceExact("invitations")
      ? null
      : aggregateStaffOverviewEvents(invitationFactEvents, window, timeZone, true),
    arrivals: !sourceExact("activities") ? null : aggregateStaffOverviewEvents(arrivalEvents, window, timeZone),
    assessments: !sourceExact("assessments") ? null : aggregateStaffOverviewEvents(assessmentEvents, window, timeZone),
    enrollments: !sourceExact("enrollments") ? null : aggregateStaffOverviewEvents(enrollmentEvents, window, timeZone),
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
  const displayName = (userId: string) => profileNames.get(userId) || userId.slice(0, 8);

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
    invitations: ["invitations"],
    arrivals: ["activities", "invitations", "leads"],
    assessments: ["assessments", "activities", "invitations", "leads"],
    enrollments: ["enrollments", "invitations", "leads"],
  };
  const supportMetricExact = (metric: StaffOverviewMetric) => supportMetricSources[metric].every(sourceExact);
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
  const teacherOutcome = teacherParticipationAvailable
    ? summarizeTeacherParticipationOutcomes(
      [
        ...arrivalEvents.map((event) => ({
          id: event.id,
          studentId: event.studentId,
          at: event.at,
          teacherIds: Array.from(assessorsByRegistrationId.get(event.id) ?? []),
        })),
        ...assessments.map((event) => ({
          id: event.id,
          studentId: event.student_id,
          at: event.created_at,
          teacherIds: event.assessed_by ? [event.assessed_by] : [],
        })),
      ],
      periodEnrollments.map((row) => ({ id: row.id, studentId: row.student_id, at: row.joined_at })),
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
      value: !sourceExact("leads") ? null : openLeads.filter((row) => row.owner_id === null || row.status === "unassigned").length,
      href: "/dashboard/leads?ownership=unassigned",
    },
    {
      key: "uncontactedLeads",
      value: !sourceExact("leads") ? null : openLeads.filter((row) => row.status === "uncontacted").length,
      href: "/dashboard/leads?status=uncontacted",
    },
    {
      key: "overdueLeadActions",
      value: !sourceExact("leads") ? null : leadActions.filter((row) => new Date(row.due_at) < now).length,
      href: "/dashboard/leads",
    },
    {
      key: "awaitingTeacher",
      value: !sourceExact("invitations") ? null : activeInvitationThreads.filter((row) => row.state === "awaiting_teacher").length,
      href: "/dashboard/invitations?state=awaiting_teacher",
    },
    {
      key: "awaitingParent",
      value: !sourceExact("invitations") ? null : activeInvitationThreads.filter((row) => row.state === "awaiting_parent").length,
      href: "/dashboard/invitations?state=awaiting_parent",
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

  return {
    generatedAt: now.toISOString(),
    timeZone,
    grain,
    currentStart: window.currentStart.toISOString(),
    currentCutoff: window.currentCutoff.toISOString(),
    previousStart: window.previousStart.toISOString(),
    previousCutoff: window.previousCutoff.toISOString(),
    snapshot,
    businessFacts,
    pendingFacts,
    supportFunnelRows,
    teacherParticipationRows,
    teacherParticipationSummary,
    capacityByGrade,
    capacityAvailable,
    teacherRows,
    unavailableSources: Array.from(unavailable),
    truncatedSources: Array.from(truncated),
  };
}

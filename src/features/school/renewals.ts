import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  loadCourseOpportunityWorkbench,
  loadPhase3EnrollmentOptions,
} from "./phase3-enrollment-data";
import type { CourseOpportunityRow } from "./phase3-enrollment-contract";
import type {
  LongTermOpportunityRow,
  ProfessionalSignalMembershipOption,
  ProfessionalSignalSessionOption,
  ReactivationStudentOption,
  ReferralLeadOption,
  ReferralReferrerOption,
  RenewalCandidateRow,
  RenewalCourseOption,
  RenewalCycleRow,
  RenewalStaffOption,
  RenewalTermOption,
  StudentReferralRow,
  TeacherProfessionalSignalRow,
} from "./renewal-contract";

interface QueryError {
  message: string;
}

interface QueryResult<T> {
  data: T | null;
  error: QueryError | null;
}

interface UntypedQuery {
  select(columns: string): UntypedQuery;
  eq(column: string, value: unknown): UntypedQuery;
  in(column: string, values: readonly unknown[]): UntypedQuery;
  is(column: string, value: null): UntypedQuery;
  not(column: string, operator: string, value: unknown): UntypedQuery;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean; referencedTable?: string }): UntypedQuery;
  limit(count: number): UntypedQuery;
  returns<T>(): PromiseLike<QueryResult<T>>;
  maybeSingle<T>(): PromiseLike<QueryResult<T>>;
}

type UntypedFrom = (relation: string) => UntypedQuery;

function from(supabase: { from: unknown }): UntypedFrom {
  return (supabase.from as UntypedFrom).bind(supabase);
}

async function rows<T>(query: PromiseLike<QueryResult<T[]>>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

interface CycleQueryRow {
  id: string;
  name: string;
  campus_id: string;
  source_term_id: string;
  target_term_id: string;
  status: RenewalCycleRow["status"];
  preparation_starts_on: string | null;
  decision_due_on: string | null;
  created_at: string;
  source_term: { name: string } | null;
  target_term: { name: string } | null;
}

interface EntryQueryRow {
  renewal_cycle_id: string;
  opportunity_id: string | null;
  source_class_membership_id: string;
  eligible_at: string;
  prepared_at: string | null;
  membership: {
    id: string;
    student_id: string;
    classroom_id: string;
    student: {
      name: string;
      grade: number | null;
      assigned_to: string | null;
      owner: { display_name: string } | null;
    } | null;
    classroom: {
      name: string;
      course_id: string | null;
      course: { title: string } | null;
    } | null;
  } | null;
}

interface SignalQueryRow {
  id: string;
  student_id: string;
  source_class_membership_id: string;
  classroom_id: string;
  source_session_id: string | null;
  signal_type: TeacherProfessionalSignalRow["signalType"];
  recommendation: string;
  suggested_course_id: string | null;
  target_term_id: string | null;
  status: TeacherProfessionalSignalRow["status"];
  opportunity_id: string | null;
  source_teacher_id: string;
  occurred_at: string;
  resolved_at: string | null;
  student: { name: string; grade: number | null } | null;
  classroom: { name: string } | null;
  source_session: { title: string } | null;
  suggested_course: { title: string } | null;
  target_term: { name: string } | null;
  source_teacher: { display_name: string } | null;
  resolver: { display_name: string } | null;
}

interface MembershipOptionQueryRow {
  id: string;
  student_id: string;
  classroom_id: string;
  status: "active" | "completed" | "transferred_out" | "withdrawn";
  joined_at: string;
  left_at: string | null;
  student: { name: string; grade: number | null } | null;
  classroom: { name: string; course_id: string | null; course: { title: string } | null } | null;
}

interface SessionOptionQueryRow {
  id: string;
  classroom_id: string;
  title: string;
  scheduled_at: string | null;
  started_at: string | null;
}

interface ReferralQueryRow {
  id: string;
  referrer_student_id: string;
  referrer_family_id: string | null;
  referrer_contact_id: string | null;
  referred_lead_id: string;
  referred_source_record_id: string | null;
  relationship: string;
  note: string;
  opportunity_id: string | null;
  created_at: string;
  referrer_student: { name: string } | null;
  referrer_family: { display_name: string } | null;
  referrer_contact: { display_name: string } | null;
  referred_lead: {
    provisional_student_name: string;
    status: string;
    owner_id: string | null;
    owner: { display_name: string } | null;
  } | null;
}

interface ReferrerQueryRow {
  id: string;
  name: string;
  family_students: Array<{
    family_id: string;
    is_primary: boolean;
    family: {
      display_name: string;
      family_contacts: Array<{
        contact_id: string;
        is_primary: boolean;
        contact: { display_name: string } | null;
      }>;
    } | null;
  }>;
}

interface LeadOptionQueryRow {
  id: string;
  provisional_student_name: string;
  phone: string;
  status: string;
  student_id: string | null;
}

interface LeadSourceQueryRow {
  id: string;
  lead_id: string;
  created_at: string;
}

interface ReactivationQueryRow {
  id: string;
  name: string;
  grade: number | null;
  follow_up_status: string;
  assigned_to: string | null;
}

function entryMap(entries: readonly EntryQueryRow[]) {
  return new Map(entries.filter((entry) => entry.opportunity_id).map((entry) => [entry.opportunity_id as string, entry]));
}

function mapOpportunity(row: CourseOpportunityRow, entries: ReadonlyMap<string, EntryQueryRow>): LongTermOpportunityRow | null {
  if (!row.studentId || !["renewal", "reactivate", "referral"].includes(row.opportunityType)) return null;
  const entry = entries.get(row.id);
  return {
    id: row.id,
    opportunityType: row.opportunityType as LongTermOpportunityRow["opportunityType"],
    studentId: row.studentId,
    studentName: row.name,
    grade: row.grade,
    courseId: row.courseId,
    courseTitle: row.courseTitle,
    termId: row.termId,
    termName: row.termName,
    stage: row.stage,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    nextAction: row.nextAction,
    nextActionAt: row.nextActionAt,
    note: row.note,
    cycleId: entry?.renewal_cycle_id ?? null,
    cycleName: "",
    sourceMembershipId: entry?.source_class_membership_id ?? null,
    sourceClassroomName: entry?.membership?.classroom?.name ?? "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadCyclesAndEntries(): Promise<{ cycles: RenewalCycleRow[]; entries: EntryQueryRow[] }> {
  const supabase = await createClient();
  const [cycleRows, entries] = await Promise.all([
    rows(from(supabase)("renewal_cycles")
      .select("id,name,campus_id,source_term_id,target_term_id,status,preparation_starts_on,decision_due_on,created_at,source_term:school_terms!renewal_cycles_source_term_id_fkey(name),target_term:school_terms!renewal_cycles_target_term_id_fkey(name)")
      .order("created_at", { ascending: false })
      .returns<CycleQueryRow[]>()),
    rows(from(supabase)("renewal_cycle_entries")
      .select("renewal_cycle_id,opportunity_id,source_class_membership_id,eligible_at,prepared_at,membership:enrollments!renewal_cycle_entries_source_class_membership_id_fkey(id,student_id,classroom_id,student:students!enrollments_student_id_fkey(name,grade,assigned_to,owner:profiles!students_assigned_to_fkey(display_name)),classroom:classrooms!enrollments_classroom_id_fkey(name,course_id,course:courses!classrooms_course_id_fkey(title)))")
      .returns<EntryQueryRow[]>()),
  ]);
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.opportunity_id) counts.set(entry.renewal_cycle_id, (counts.get(entry.renewal_cycle_id) ?? 0) + 1);
  }
  return {
    cycles: cycleRows.map((cycle) => ({
      id: cycle.id,
      name: cycle.name,
      campusId: cycle.campus_id,
      sourceTermId: cycle.source_term_id,
      sourceTermName: cycle.source_term?.name ?? "-",
      targetTermId: cycle.target_term_id,
      targetTermName: cycle.target_term?.name ?? "-",
      status: cycle.status,
      preparationStartsOn: cycle.preparation_starts_on,
      decisionDueOn: cycle.decision_due_on,
      opportunityCount: counts.get(cycle.id) ?? 0,
      createdAt: cycle.created_at,
    })),
    entries,
  };
}

export interface RenewalWorkspaceData {
  cycles: RenewalCycleRow[];
  selectedCycleId: string | null;
  candidates: RenewalCandidateRow[];
  opportunities: LongTermOpportunityRow[];
  courses: RenewalCourseOption[];
  terms: RenewalTermOption[];
}

export async function loadRenewalWorkspace(requestedCycleId?: string | null): Promise<RenewalWorkspaceData> {
  const [{ cycles, entries }, workbench, options] = await Promise.all([
    loadCyclesAndEntries(),
    loadCourseOpportunityWorkbench(),
    loadPhase3EnrollmentOptions(),
  ]);
  const selectedCycle = cycles.find((cycle) => cycle.id === requestedCycleId)
    ?? cycles.find((cycle) => cycle.status === "open")
    ?? cycles[0]
    ?? null;
  const cycleById = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const mappedEntries = entryMap(entries);
  const opportunities = workbench.opportunities
    .map((row) => mapOpportunity(row, mappedEntries))
    .filter((row): row is LongTermOpportunityRow => row !== null)
    .map((row) => ({ ...row, cycleName: row.cycleId ? cycleById.get(row.cycleId)?.name ?? "" : "" }));

  const candidates = selectedCycle
    ? entries.filter((entry) => entry.renewal_cycle_id === selectedCycle.id && !entry.opportunity_id)
      .map((entry): RenewalCandidateRow | null => {
        const membership = entry.membership;
        if (!membership?.student || !membership.classroom) return null;
        return {
          membershipId: membership.id,
          studentId: membership.student_id,
          studentName: membership.student.name,
          grade: membership.student.grade,
          classroomId: membership.classroom_id,
          classroomName: membership.classroom.name,
          sourceCourseId: membership.classroom.course_id,
          sourceCourseTitle: membership.classroom.course?.title ?? "",
          currentOwnerId: membership.student.assigned_to,
          currentOwnerName: membership.student.owner?.display_name ?? "",
          ready: membership.classroom.course_id !== null,
        };
      }).filter((row): row is RenewalCandidateRow => row !== null)
      .sort((left, right) => left.studentName.localeCompare(right.studentName, "zh"))
    : [];

  return {
    cycles,
    selectedCycleId: selectedCycle?.id ?? null,
    candidates,
    opportunities,
    courses: options.courses.map((course) => ({ id: course.id, title: course.title, grade: course.grade })),
    terms: options.terms.map((term) => ({
      id: term.id,
      name: term.name,
      startsOn: term.startsOn,
      endsOn: term.endsOn,
    })),
  };
}

export async function loadLongTermOpportunity(opportunityId: string): Promise<LongTermOpportunityRow | null> {
  const workspace = await loadRenewalWorkspace();
  return workspace.opportunities.find((opportunity) => opportunity.id === opportunityId) ?? null;
}

export interface ProfessionalSignalsData {
  signals: TeacherProfessionalSignalRow[];
  memberships: ProfessionalSignalMembershipOption[];
  sessions: ProfessionalSignalSessionOption[];
  courses: RenewalCourseOption[];
  terms: RenewalTermOption[];
}

export async function loadProfessionalSignalsData(): Promise<ProfessionalSignalsData> {
  const supabase = await createClient();
  const [signalRows, membershipRows, sessionRows, options] = await Promise.all([
    rows(from(supabase)("teacher_professional_signals")
      .select("id,student_id,source_class_membership_id,classroom_id,source_session_id,signal_type,recommendation,suggested_course_id,target_term_id,status,opportunity_id,source_teacher_id,occurred_at,resolved_at,student:students!teacher_professional_signals_student_id_fkey(name,grade),classroom:classrooms!teacher_professional_signals_classroom_id_fkey(name),source_session:class_sessions!teacher_professional_signals_source_session_id_fkey(title),suggested_course:courses!teacher_professional_signals_suggested_course_id_fkey(title),target_term:school_terms!teacher_professional_signals_target_term_id_fkey(name),source_teacher:profiles!teacher_professional_signals_source_teacher_id_fkey(display_name),resolver:profiles!teacher_professional_signals_resolved_by_fkey(display_name)")
      .order("occurred_at", { ascending: false })
      .limit(500)
      .returns<SignalQueryRow[]>()),
    rows(from(supabase)("enrollments")
      .select("id,student_id,classroom_id,status,joined_at,left_at,student:students!enrollments_student_id_fkey(name,grade),classroom:classrooms!enrollments_classroom_id_fkey(name,course_id,course:courses!classrooms_course_id_fkey(title))")
      .in("status", ["active", "completed", "transferred_out", "withdrawn"])
      .returns<MembershipOptionQueryRow[]>()),
    rows(from(supabase)("class_sessions")
      .select("id,classroom_id,title,scheduled_at,started_at")
      .is("deleted_at", null)
      .is("cancelled_by", null)
      .is("voided_at", null)
      .order("scheduled_at", { ascending: false })
      .limit(500)
      .returns<SessionOptionQueryRow[]>()),
    loadPhase3EnrollmentOptions(),
  ]);

  return {
    signals: signalRows.map((signal) => ({
      id: signal.id,
      studentId: signal.student_id,
      studentName: signal.student?.name ?? "-",
      grade: signal.student?.grade ?? null,
      sourceMembershipId: signal.source_class_membership_id,
      classroomId: signal.classroom_id,
      sourceClassroomName: signal.classroom?.name ?? "-",
      sourceSessionId: signal.source_session_id,
      sourceSessionTitle: signal.source_session?.title ?? "",
      signalType: signal.signal_type,
      recommendation: signal.recommendation,
      suggestedCourseId: signal.suggested_course_id,
      suggestedCourseTitle: signal.suggested_course?.title ?? "",
      targetTermId: signal.target_term_id,
      targetTermName: signal.target_term?.name ?? "",
      sourceTeacherId: signal.source_teacher_id,
      sourceTeacherName: signal.source_teacher?.display_name ?? "-",
      status: signal.status,
      opportunityId: signal.opportunity_id,
      handledByName: signal.resolver?.display_name ?? "",
      resolvedAt: signal.resolved_at,
      occurredAt: signal.occurred_at,
    })),
    memberships: membershipRows.filter((row) => row.student && row.classroom).map((row) => ({
      membershipId: row.id,
      studentId: row.student_id,
      studentName: row.student?.name ?? "-",
      grade: row.student?.grade ?? null,
      classroomId: row.classroom_id,
      classroomName: row.classroom?.name ?? "-",
      currentCourseId: row.classroom?.course_id ?? null,
      currentCourseTitle: row.classroom?.course?.title ?? "",
      status: row.status,
      joinedAt: row.joined_at,
      leftAt: row.left_at,
    })),
    sessions: sessionRows.map((session) => ({
      id: session.id,
      classroomId: session.classroom_id,
      title: session.title,
      scheduledAt: session.scheduled_at,
      startedAt: session.started_at,
    })),
    courses: options.courses.map((course) => ({ id: course.id, title: course.title, grade: course.grade })),
    terms: options.terms.map((term) => ({
      id: term.id,
      name: term.name,
      startsOn: term.startsOn,
      endsOn: term.endsOn,
    })),
  };
}

export interface GrowthWorkspaceData {
  reactivationOpportunities: LongTermOpportunityRow[];
  reactivationStudents: ReactivationStudentOption[];
  referrals: StudentReferralRow[];
  referrers: ReferralReferrerOption[];
  leads: ReferralLeadOption[];
  courses: RenewalCourseOption[];
  terms: RenewalTermOption[];
}

export async function loadGrowthWorkspaceData(): Promise<GrowthWorkspaceData> {
  const supabase = await createClient();
  const [workspace, options, referralRows, referrerRows, leadRows, leadSources, reactivationRows] = await Promise.all([
    loadRenewalWorkspace(),
    loadPhase3EnrollmentOptions(),
    rows(from(supabase)("student_referrals")
      .select("id,referrer_student_id,referrer_family_id,referrer_contact_id,referred_lead_id,referred_source_record_id,relationship,note,opportunity_id,created_at,referrer_student:students!student_referrals_referrer_student_id_fkey(name),referrer_family:families!student_referrals_referrer_family_id_fkey(display_name),referrer_contact:contacts!student_referrals_referrer_contact_id_fkey(display_name),referred_lead:leads!student_referrals_referred_lead_id_fkey(provisional_student_name,status,owner_id,owner:profiles!leads_owner_id_fkey(display_name))")
      .order("created_at", { ascending: false })
      .limit(500)
      .returns<ReferralQueryRow[]>()),
    rows(from(supabase)("students")
      .select("id,name,family_students(family_id,is_primary,family:families!family_students_family_id_fkey(display_name,family_contacts(contact_id,is_primary,contact:contacts!family_contacts_contact_id_fkey(display_name))))")
      .is("deleted_at", null)
      .order("name", { ascending: true })
      .limit(500)
      .returns<ReferrerQueryRow[]>()),
    rows(from(supabase)("leads")
      .select("id,provisional_student_name,phone,status,student_id")
      .not("status", "eq", "invalid")
      .order("created_at", { ascending: false })
      .limit(500)
      .returns<LeadOptionQueryRow[]>()),
    rows(from(supabase)("lead_source_records")
      .select("id,lead_id,created_at")
      .order("created_at", { ascending: false })
      .limit(1000)
      .returns<LeadSourceQueryRow[]>()),
    rows(from(supabase)("students")
      .select("id,name,grade,follow_up_status,assigned_to")
      .eq("follow_up_status", "lost")
      .is("deleted_at", null)
      .order("name", { ascending: true })
      .limit(500)
      .returns<ReactivationQueryRow[]>()),
  ]);
  const sourceByLead = new Map<string, string>();
  for (const source of leadSources) if (!sourceByLead.has(source.lead_id)) sourceByLead.set(source.lead_id, source.id);

  return {
    reactivationOpportunities: workspace.opportunities.filter((opportunity) => opportunity.opportunityType === "reactivate"),
    reactivationStudents: reactivationRows.map((student) => ({
      id: student.id,
      name: student.name,
      grade: student.grade,
      followUpStatus: student.follow_up_status,
      assignedTo: student.assigned_to,
    })),
    referrals: referralRows.map((referral) => ({
      id: referral.id,
      referrerStudentId: referral.referrer_student_id,
      referrerStudentName: referral.referrer_student?.name ?? "-",
      referrerFamilyId: referral.referrer_family_id,
      referrerFamilyName: referral.referrer_family?.display_name ?? "",
      referrerContactId: referral.referrer_contact_id,
      referrerContactName: referral.referrer_contact?.display_name ?? "",
      referredLeadId: referral.referred_lead_id,
      referredSourceRecordId: referral.referred_source_record_id,
      referredLeadName: referral.referred_lead?.provisional_student_name ?? "-",
      referredLeadStatus: referral.referred_lead?.status ?? "",
      leadOwnerId: referral.referred_lead?.owner_id ?? null,
      leadOwnerName: referral.referred_lead?.owner?.display_name ?? "",
      relationship: referral.relationship,
      note: referral.note,
      opportunityId: referral.opportunity_id,
      createdAt: referral.created_at,
    })),
    referrers: referrerRows.map((student) => {
      const family = [...student.family_students].sort((a, b) => Number(b.is_primary) - Number(a.is_primary))[0];
      const contact = family?.family?.family_contacts
        ? [...family.family.family_contacts].sort((a, b) => Number(b.is_primary) - Number(a.is_primary))[0]
        : undefined;
      return {
        studentId: student.id,
        studentName: student.name,
        familyId: family?.family_id ?? null,
        familyName: family?.family?.display_name ?? "",
        contactId: contact?.contact_id ?? null,
        contactName: contact?.contact?.display_name ?? "",
      };
    }),
    leads: leadRows.map((lead) => ({
      id: lead.id,
      name: lead.provisional_student_name,
      phone: lead.phone,
      status: lead.status,
      studentId: lead.student_id,
      sourceRecordId: sourceByLead.get(lead.id) ?? null,
    })),
    courses: options.courses.map((course) => ({ id: course.id, title: course.title, grade: course.grade })),
    terms: options.terms.map((term) => ({
      id: term.id,
      name: term.name,
      startsOn: term.startsOn,
      endsOn: term.endsOn,
    })),
  };
}

export function renewalStaffOptions(members: readonly { userId: string; displayName: string; isActive: boolean; canFollowUp: boolean }[]): RenewalStaffOption[] {
  return members
    .filter((member) => member.isActive && member.canFollowUp)
    .map((member) => ({ id: member.userId, name: member.displayName }))
    .sort((left, right) => left.name.localeCompare(right.name, "zh"));
}

export function scopedRenewalStaffOptions(
  members: readonly { userId: string; displayName: string; isActive: boolean; canFollowUp: boolean }[],
  actorId: string,
  canAssign: boolean,
): RenewalStaffOption[] {
  const options = renewalStaffOptions(members);
  return canAssign ? options : options.filter((option) => option.id === actorId);
}

import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ActivityRouteKind, StoredAssessmentBand } from "./activity-workflow-contract";
import type {
  AssessmentWorkbenchAssessment,
  AssessmentWorkbenchRoute,
  AssessmentWorkbenchRow,
} from "./assessment-workbench-contract";

interface LeadSubjectRow {
  id: string;
  provisional_student_name: string;
  phone: string;
  grade_hint: number | null;
  grade_text: string;
  student_id: string | null;
}
interface StudentSubjectRow {
  id: string;
  name: string;
  phone: string;
  parent_phone: string;
  grade: number | null;
  remark: string;
}

interface InvitationDbRow {
  id: string;
  lead_id: string;
  assessor_id: string | null;
  scheduled_at: string | null;
  location_text: string;
  summary: string;
  updated_at: string;
  leads: LeadSubjectRow | null;
  assessor: { display_name: string } | null;
}

interface ActivityDbRow {
  id: string;
  title: string;
  scheduled_at: string;
  location: string;
  source_invitation_id: string | null;
  activity_registrations: Array<{
    id: string;
    student_id: string | null;
    lead_id: string | null;
    status: AssessmentWorkbenchRow["participationStatus"];
    outcome: string;
    updated_at: string;
    students: StudentSubjectRow | null;
    leads: LeadSubjectRow | null;
  }>;
}

interface AssessmentDbRow {
  id: string;
  activity_registration_id: string;
  assessment_band: StoredAssessmentBand | null;
  score: number | null;
  strengths: string;
  focus_areas: string;
  parent_concerns: string;
  teacher_recommendation: string;
  recommended_class: string;
  updated_at: string;
  assessor: { display_name: string } | null;
}

interface RouteDbRow {
  id: string;
  activity_registration_id: string;
  route: ActivityRouteKind;
  note: string;
  updated_at: string;
}

interface UntypedPostgrestResult<T> {
  data: T | null;
  error: { message: string } | null;
}

interface UntypedPostgrestFilter {
  eq(column: string, value: unknown): UntypedPostgrestFilter;
  is(column: string, value: null): UntypedPostgrestFilter;
  in(column: string, values: readonly string[]): UntypedPostgrestFilter;
  order(column: string, options?: { ascending?: boolean }): UntypedPostgrestFilter;
  limit(value: number): UntypedPostgrestFilter;
  returns<T>(): PromiseLike<UntypedPostgrestResult<T>>;
}

interface UntypedPostgrestQuery {
  select(columns: string): UntypedPostgrestFilter;
}

type UntypedFrom = (relation: string) => UntypedPostgrestQuery;

function from(supabase: { from: unknown }): UntypedFrom {
  return (supabase.from as UntypedFrom).bind(supabase);
}

const INVITATION_COLUMNS = [
  "id",
  "lead_id",
  "assessor_id",
  "scheduled_at",
  "location_text",
  "summary",
  "updated_at",
  "leads(id,provisional_student_name,phone,grade_hint,grade_text,student_id)",
  "assessor:profiles!lead_invitation_threads_assessor_id_fkey(display_name)",
].join(",");

const ACTIVITY_COLUMNS = [
  "id",
  "title",
  "scheduled_at",
  "location",
  "source_invitation_id",
  [
    "activity_registrations(",
    "id,student_id,lead_id,status,outcome,updated_at,",
    "students(id,name,phone,parent_phone,grade,remark),",
    "leads(id,provisional_student_name,phone,grade_hint,grade_text,student_id)",
    ")",
  ].join(""),
].join(",");

export async function listAssessmentWorkbenchRows(): Promise<AssessmentWorkbenchRow[]> {
  const supabase = await createClient();
  const [activityResult, confirmedInvitationResult] = await Promise.all([
    from(supabase)("activities")
      .select(ACTIVITY_COLUMNS)
      .eq("kind", "assessment_1v1")
      .is("deleted_at", null)
      .order("scheduled_at", { ascending: true })
      .limit(500)
      .returns<ActivityDbRow[]>(),
    from(supabase)("lead_invitation_threads")
      .select(INVITATION_COLUMNS)
      .eq("kind", "assessment_1v1")
      .eq("state", "confirmed")
      .order("scheduled_at", { ascending: true })
      .limit(500)
      .returns<InvitationDbRow[]>(),
  ]);
  if (activityResult.error) throw new Error(activityResult.error.message);
  if (confirmedInvitationResult.error) throw new Error(confirmedInvitationResult.error.message);

  const activities = activityResult.data ?? [];
  const registrations = activities.flatMap((activity) => activity.activity_registrations.map((registration) => ({
    activity,
    registration,
  })));
  const registrationIds = registrations.map(({ registration }) => registration.id);
  const sourceInvitationIds = [...new Set(activities
    .map((activity) => activity.source_invitation_id)
    .filter((id): id is string => Boolean(id)))];

  const [assessmentResult, routeResult, historicalInvitationResult] = await Promise.all([
    registrationIds.length > 0
      ? from(supabase)("assessment_results")
          .select("id,activity_registration_id,assessment_band,score,strengths,focus_areas,parent_concerns,teacher_recommendation,recommended_class,updated_at,assessor:profiles!assessment_results_assessed_by_fkey(display_name)")
          .in("activity_registration_id", registrationIds)
          .returns<AssessmentDbRow[]>()
      : Promise.resolve({ data: [] as AssessmentDbRow[], error: null }),
    registrationIds.length > 0
      ? from(supabase)("activity_routes")
          .select("id,activity_registration_id,route,note,updated_at")
          .in("activity_registration_id", registrationIds)
          .returns<RouteDbRow[]>()
      : Promise.resolve({ data: [] as RouteDbRow[], error: null }),
    sourceInvitationIds.length > 0
      ? from(supabase)("lead_invitation_threads")
          .select(INVITATION_COLUMNS)
          .in("id", sourceInvitationIds)
          .returns<InvitationDbRow[]>()
      : Promise.resolve({ data: [] as InvitationDbRow[], error: null }),
  ]);
  if (assessmentResult.error) throw new Error(assessmentResult.error.message);
  if (routeResult.error) throw new Error(routeResult.error.message);
  if (historicalInvitationResult.error) throw new Error(historicalInvitationResult.error.message);

  const assessments = new Map<string, AssessmentWorkbenchAssessment>();
  const assessmentAssessorNames = new Map<string, string>();
  for (const row of assessmentResult.data ?? []) {
    assessments.set(row.activity_registration_id, {
      id: row.id,
      assessmentBand: row.assessment_band,
      score: row.score,
      strengths: row.strengths,
      focusAreas: row.focus_areas,
      parentConcerns: row.parent_concerns,
      teacherRecommendation: row.teacher_recommendation,
      recommendedClass: row.recommended_class,
      updatedAt: row.updated_at,
    });
    assessmentAssessorNames.set(row.activity_registration_id, row.assessor?.display_name ?? "");
  }
  const routes = new Map<string, AssessmentWorkbenchRoute>();
  for (const row of routeResult.data ?? []) {
    routes.set(row.activity_registration_id, {
      id: row.id,
      route: row.route,
      note: row.note,
      updatedAt: row.updated_at,
    });
  }
  const invitations = new Map<string, InvitationDbRow>();
  for (const row of historicalInvitationResult.data ?? []) invitations.set(row.id, row);
  for (const row of confirmedInvitationResult.data ?? []) invitations.set(row.id, row);

  const materializedInvitationIds = new Set(sourceInvitationIds);
  const pendingRows = (confirmedInvitationResult.data ?? [])
    .filter((invitation) => invitation.scheduled_at && invitation.leads && !materializedInvitationIds.has(invitation.id))
    .map((invitation): AssessmentWorkbenchRow => ({
      id: `invitation:${invitation.id}`,
      invitationId: invitation.id,
      registrationId: null,
      studentId: invitation.leads?.student_id ?? null,
      leadId: invitation.lead_id,
      name: invitation.leads?.provisional_student_name ?? "-",
      phone: invitation.leads?.phone ?? "",
      grade: invitation.leads?.grade_hint ?? null,
      gradeText: invitation.leads?.grade_text ?? "",
      scheduledAt: invitation.scheduled_at ?? invitation.updated_at,
      location: invitation.location_text,
      assessorName: invitation.assessor?.display_name ?? "",
      background: invitation.summary,
      participationStatus: "booked",
      assessment: null,
      route: null,
      updatedAt: invitation.updated_at,
    }));

  const materializedRows = registrations
    .filter(({ registration }) => registration.status !== "cancelled")
    .map(({ activity, registration }): AssessmentWorkbenchRow => {
      const invitation = activity.source_invitation_id
        ? invitations.get(activity.source_invitation_id)
        : undefined;
      const student = registration.students;
      const lead = registration.leads ?? invitation?.leads ?? null;
      const assessment = assessments.get(registration.id) ?? null;
      const route = routes.get(registration.id) ?? null;
      return {
        id: `registration:${registration.id}`,
        invitationId: activity.source_invitation_id,
        registrationId: registration.id,
        studentId: registration.student_id,
        leadId: registration.lead_id,
        name: student?.name ?? lead?.provisional_student_name ?? "-",
        phone: student?.parent_phone || student?.phone || lead?.phone || "",
        grade: student?.grade ?? lead?.grade_hint ?? null,
        gradeText: lead?.grade_text ?? "",
        scheduledAt: activity.scheduled_at,
        location: activity.location,
        assessorName: invitation?.assessor?.display_name
          || assessmentAssessorNames.get(registration.id)
          || "",
        background: invitation?.summary || registration.outcome || student?.remark || "",
        participationStatus: registration.status,
        assessment,
        route,
        updatedAt: assessment?.updatedAt || route?.updatedAt || registration.updated_at,
      };
    });

  return [...pendingRows, ...materializedRows];
}

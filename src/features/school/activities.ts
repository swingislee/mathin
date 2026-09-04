import { createClient } from "@/lib/supabase/server";
import type { ActivityRouteKind, StoredAssessmentBand } from "./activity-workflow-contract";
import type { ActivityKind } from "./activity-kinds";

export type { ActivityKind } from "./activity-kinds";

export interface ActivityAssessmentResult {
  id: string;
  assessmentBand: StoredAssessmentBand | null;
  score: number | null;
  strengths: string;
  focusAreas: string;
  parentConcerns: string;
  teacherRecommendation: string;
  recommendedClass: string;
  assessorName: string;
  updatedAt: string;
}

export interface ActivityRoute {
  id: string;
  route: ActivityRouteKind;
  note: string;
  routedByName: string;
  updatedAt: string;
}

export interface ActivityRegistration {
  id: string;
  studentId: string;
  studentName: string;
  studentGrade: number | null;
  status: "booked" | "attended" | "no_show" | "cancelled";
  outcome: string;
  assessment: ActivityAssessmentResult | null;
  route: ActivityRoute | null;
}

export interface ActivityRow {
  id: string;
  kind: ActivityKind;
  title: string;
  scheduledAt: string;
  durationMin: number | null;
  location: string;
  capacity: number | null;
  remark: string;
  registrations: ActivityRegistration[];
}

export interface ActivityWorkspaceSummary {
  activeRegistrations: number;
  attended: number;
  assessed: number;
  awaitingRoute: number;
}

interface ActivityQueryRow {
  id: string;
  kind: ActivityKind;
  title: string;
  scheduled_at: string;
  duration_min: number | null;
  location: string;
  capacity: number | null;
  remark: string;
  activity_registrations: Array<{
    id: string;
    student_id: string;
    status: ActivityRegistration["status"];
    outcome: string;
    students: { name: string; grade: number | null } | null;
  }>;
}

interface AssessmentQueryRow {
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

interface RouteQueryRow {
  id: string;
  activity_registration_id: string;
  route: ActivityRouteKind;
  note: string;
  updated_at: string;
  routed_by: { display_name: string } | null;
}

interface UntypedPostgrestResult<T> {
  data: T | null;
  error: { message: string } | null;
}

interface UntypedPostgrestFilter {
  in(column: string, values: readonly string[]): UntypedPostgrestFilter;
  returns<T>(): PromiseLike<UntypedPostgrestResult<T>>;
}

interface UntypedPostgrestQuery {
  select(columns: string): UntypedPostgrestFilter;
}

type UntypedFrom = (relation: string) => UntypedPostgrestQuery;

function from(supabase: { from: unknown }): UntypedFrom {
  return (supabase.from as UntypedFrom).bind(supabase);
}

async function readActivities(activityId?: string): Promise<ActivityRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("activities")
    .select("id,kind,title,scheduled_at,duration_min,location,capacity,remark,activity_registrations(id,student_id,status,outcome,students(name,grade))")
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: true });
  if (activityId) query = query.eq("id", activityId);
  else query = query.is("source_invitation_id", null);

  const { data, error } = await query.returns<ActivityQueryRow[]>();
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const registrationIds = rows.flatMap((activity) => activity.activity_registrations.map((registration) => registration.id));

  const assessments = new Map<string, AssessmentQueryRow>();
  const routes = new Map<string, RouteQueryRow>();
  if (registrationIds.length > 0) {
    const [assessmentResult, routeResult] = await Promise.all([
      from(supabase)("assessment_results")
        .select("id,activity_registration_id,assessment_band,score,strengths,focus_areas,parent_concerns,teacher_recommendation,recommended_class,updated_at,assessor:profiles!assessment_results_assessed_by_fkey(display_name)")
        .in("activity_registration_id", registrationIds)
        .returns<AssessmentQueryRow[]>(),
      from(supabase)("activity_routes")
        .select("id,activity_registration_id,route,note,updated_at,routed_by:profiles!activity_routes_routed_by_fkey(display_name)")
        .in("activity_registration_id", registrationIds)
        .returns<RouteQueryRow[]>(),
    ]);
    if (assessmentResult.error) throw new Error(assessmentResult.error.message);
    if (routeResult.error) throw new Error(routeResult.error.message);
    for (const assessment of assessmentResult.data ?? []) assessments.set(assessment.activity_registration_id, assessment);
    for (const route of routeResult.data ?? []) routes.set(route.activity_registration_id, route);
  }

  return rows.map((activity) => ({
    id: activity.id,
    kind: activity.kind,
    title: activity.title,
    scheduledAt: activity.scheduled_at,
    durationMin: activity.duration_min,
    location: activity.location,
    capacity: activity.capacity,
    remark: activity.remark,
    registrations: activity.activity_registrations
      .map((registration): ActivityRegistration => {
        const assessment = assessments.get(registration.id);
        const route = routes.get(registration.id);
        return {
          id: registration.id,
          studentId: registration.student_id,
          studentName: registration.students?.name ?? "-",
          studentGrade: registration.students?.grade ?? null,
          status: registration.status,
          outcome: registration.outcome,
          assessment: assessment ? {
            id: assessment.id,
            assessmentBand: assessment.assessment_band,
            score: assessment.score,
            strengths: assessment.strengths,
            focusAreas: assessment.focus_areas,
            parentConcerns: assessment.parent_concerns,
            teacherRecommendation: assessment.teacher_recommendation,
            recommendedClass: assessment.recommended_class,
            assessorName: assessment.assessor?.display_name ?? "-",
            updatedAt: assessment.updated_at,
          } : null,
          route: route ? {
            id: route.id,
            route: route.route,
            note: route.note,
            routedByName: route.routed_by?.display_name ?? "-",
            updatedAt: route.updated_at,
          } : null,
        };
      })
      .sort((left, right) => left.studentName.localeCompare(right.studentName, "zh")),
  }));
}

export async function listActivities(): Promise<ActivityRow[]> {
  return readActivities();
}

export async function getActivity(activityId: string): Promise<ActivityRow | null> {
  return (await readActivities(activityId))[0] ?? null;
}

export function summarizeActivityWorkspace(activities: readonly ActivityRow[]): ActivityWorkspaceSummary {
  const registrations = activities.flatMap((activity) => activity.registrations);
  return {
    activeRegistrations: registrations.filter((registration) => registration.status !== "cancelled").length,
    attended: registrations.filter((registration) => registration.status === "attended").length,
    assessed: registrations.filter((registration) => registration.assessment !== null).length,
    awaitingRoute: registrations.filter((registration) =>
      registration.status === "attended" && registration.assessment !== null && registration.route === null
    ).length,
  };
}

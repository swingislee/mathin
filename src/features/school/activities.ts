import { createClient } from "@/lib/supabase/server";
import type { AssessmentLevel, OpportunityStage } from "./activity-funnel-contract";
import type { ActivityKind } from "./activity-kinds";

export type { ActivityKind } from "./activity-kinds";

export interface ActivityAssessmentResult {
  id: string;
  overallLevel: AssessmentLevel;
  score: number | null;
  strengths: string;
  focusAreas: string;
  teacherRecommendation: string;
  assessorName: string;
  updatedAt: string;
}

export interface ActivitySalesOpportunity {
  id: string;
  stage: OpportunityStage;
  ownerId: string | null;
  ownerName: string;
  nextAction: string;
  nextActionAt: string | null;
  note: string;
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
  opportunity: ActivitySalesOpportunity | null;
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

export interface ActivityFunnelSummary {
  booked: number;
  attended: number;
  assessed: number;
  opportunities: number;
  won: number;
}

export interface OpportunityOwnerOption {
  userId: string;
  displayName: string;
}

export interface SalesOpportunityQueueRow {
  id: string;
  registrationId: string;
  activityId: string;
  activityTitle: string;
  activityScheduledAt: string;
  studentId: string;
  studentName: string;
  studentGrade: number | null;
  stage: OpportunityStage;
  ownerId: string | null;
  ownerName: string;
  nextAction: string;
  nextActionAt: string | null;
  teacherRecommendation: string;
  updatedAt: string;
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
  overall_level: AssessmentLevel;
  score: number | null;
  strengths: string;
  focus_areas: string;
  teacher_recommendation: string;
  updated_at: string;
  assessor: { display_name: string } | null;
}

interface OpportunityQueryRow {
  id: string;
  source_registration_id: string;
  stage: OpportunityStage;
  owner_id: string | null;
  next_action: string;
  next_action_at: string | null;
  note: string;
  updated_at: string;
  owner: { display_name: string } | null;
}

interface UntypedPostgrestResult<T> {
  data: T | null;
  error: { message: string } | null;
}

interface UntypedPostgrestFilter {
  in(column: string, values: readonly string[]): UntypedPostgrestFilter;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): UntypedPostgrestFilter;
  returns<T>(): PromiseLike<UntypedPostgrestResult<T>>;
}

interface UntypedPostgrestQuery {
  select(columns: string): UntypedPostgrestFilter;
}

type UntypedFrom = (relation: string) => UntypedPostgrestQuery;
type UntypedRpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

function from(supabase: { from: unknown }): UntypedFrom {
  return (supabase.from as UntypedFrom).bind(supabase);
}

function rpc(supabase: { rpc: unknown }): UntypedRpc {
  return (supabase.rpc as UntypedRpc).bind(supabase);
}

async function readActivities(activityId?: string): Promise<ActivityRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("activities")
    .select("id,kind,title,scheduled_at,duration_min,location,capacity,remark,activity_registrations(id,student_id,status,outcome,students(name,grade))")
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: true });
  if (activityId) query = query.eq("id", activityId);

  const { data, error } = await query.returns<ActivityQueryRow[]>();
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const registrationIds = rows.flatMap((activity) => activity.activity_registrations.map((registration) => registration.id));

  const assessments = new Map<string, AssessmentQueryRow>();
  const opportunities = new Map<string, OpportunityQueryRow>();
  if (registrationIds.length > 0) {
    const [assessmentResult, opportunityResult] = await Promise.all([
      from(supabase)("assessment_results")
        .select("id,activity_registration_id,overall_level,score,strengths,focus_areas,teacher_recommendation,updated_at,assessor:profiles!assessment_results_assessed_by_fkey(display_name)")
        .in("activity_registration_id", registrationIds)
        .returns<AssessmentQueryRow[]>(),
      from(supabase)("sales_opportunities")
        .select("id,source_registration_id,stage,owner_id,next_action,next_action_at,note,updated_at,owner:profiles!sales_opportunities_owner_id_fkey(display_name)")
        .in("source_registration_id", registrationIds)
        .returns<OpportunityQueryRow[]>(),
    ]);
    if (assessmentResult.error) throw new Error(assessmentResult.error.message);
    if (opportunityResult.error) throw new Error(opportunityResult.error.message);
    for (const assessment of assessmentResult.data ?? []) assessments.set(assessment.activity_registration_id, assessment);
    for (const opportunity of opportunityResult.data ?? []) opportunities.set(opportunity.source_registration_id, opportunity);
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
        const opportunity = opportunities.get(registration.id);
        return {
          id: registration.id,
          studentId: registration.student_id,
          studentName: registration.students?.name ?? "-",
          studentGrade: registration.students?.grade ?? null,
          status: registration.status,
          outcome: registration.outcome,
          assessment: assessment ? {
            id: assessment.id,
            overallLevel: assessment.overall_level,
            score: assessment.score,
            strengths: assessment.strengths,
            focusAreas: assessment.focus_areas,
            teacherRecommendation: assessment.teacher_recommendation,
            assessorName: assessment.assessor?.display_name ?? "-",
            updatedAt: assessment.updated_at,
          } : null,
          opportunity: opportunity ? {
            id: opportunity.id,
            stage: opportunity.stage,
            ownerId: opportunity.owner_id,
            ownerName: opportunity.owner?.display_name ?? "-",
            nextAction: opportunity.next_action,
            nextActionAt: opportunity.next_action_at,
            note: opportunity.note,
            updatedAt: opportunity.updated_at,
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

export function summarizeActivityFunnel(activities: readonly ActivityRow[]): ActivityFunnelSummary {
  const registrations = activities.flatMap((activity) => activity.registrations);
  return {
    booked: registrations.filter((registration) => registration.status !== "cancelled").length,
    attended: registrations.filter((registration) => registration.status === "attended").length,
    assessed: registrations.filter((registration) => registration.assessment !== null).length,
    opportunities: registrations.filter((registration) => registration.opportunity !== null).length,
    won: registrations.filter((registration) => registration.opportunity?.stage === "won").length,
  };
}

export async function listSalesOpportunityOwners(): Promise<OpportunityOwnerOption[]> {
  const supabase = await createClient();
  const { data, error } = await rpc(supabase)("list_sales_opportunity_owners");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ user_id: string; display_name: string }>).map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
  }));
}

export async function listSalesOpportunities(): Promise<SalesOpportunityQueueRow[]> {
  const supabase = await createClient();
  const { data, error } = await from(supabase)("sales_opportunities")
    .select("id,source_registration_id,student_id,stage,owner_id,next_action,next_action_at,updated_at,owner:profiles!sales_opportunities_owner_id_fkey(display_name),students(name,grade),registration:activity_registrations!sales_opportunities_source_registration_id_fkey(activity_id,activities(title,scheduled_at),assessment_results(teacher_recommendation))")
    .order("next_action_at", { ascending: true, nullsFirst: false })
    .returns<Array<{
      id: string;
      source_registration_id: string;
      student_id: string;
      stage: OpportunityStage;
      owner_id: string | null;
      next_action: string;
      next_action_at: string | null;
      updated_at: string;
      owner: { display_name: string } | null;
      students: { name: string; grade: number | null } | null;
      registration: {
        activity_id: string;
        activities: { title: string; scheduled_at: string } | null;
        assessment_results: { teacher_recommendation: string } | Array<{ teacher_recommendation: string }> | null;
      } | null;
    }>>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const embeddedAssessment = row.registration?.assessment_results;
    const assessment = Array.isArray(embeddedAssessment) ? embeddedAssessment[0] : embeddedAssessment;
    return {
      id: row.id,
      registrationId: row.source_registration_id,
      activityId: row.registration?.activity_id ?? "",
      activityTitle: row.registration?.activities?.title ?? "-",
      activityScheduledAt: row.registration?.activities?.scheduled_at ?? row.updated_at,
      studentId: row.student_id,
      studentName: row.students?.name ?? "-",
      studentGrade: row.students?.grade ?? null,
      stage: row.stage,
      ownerId: row.owner_id,
      ownerName: row.owner?.display_name ?? "-",
      nextAction: row.next_action,
      nextActionAt: row.next_action_at,
      teacherRecommendation: assessment?.teacher_recommendation ?? "",
      updatedAt: row.updated_at,
    };
  });
}

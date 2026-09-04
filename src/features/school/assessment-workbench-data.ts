import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ActivityRouteKind, StoredAssessmentBand } from "./activity-workflow-contract";
import type {
  AssessmentWorkbenchAssessment,
  AssessmentWorkbenchQuestionSummary,
  AssessmentWorkbenchRoute,
  AssessmentWorkbenchRow,
} from "./assessment-workbench-contract";
import {
  TEACHER_ASSESSMENT_OUTCOMES,
  type TeacherAssessmentOutcome,
} from "./teacher-assessment-contract";

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
    assessment_paper_version_id: string | null;
    assessment_started_at: string | null;
    assessment_completed_at: string | null;
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
  teacher_observation: string;
  updated_at: string;
  assessor: { id: string; display_name: string } | null;
}

interface RouteDbRow {
  id: string;
  activity_registration_id: string;
  route: ActivityRouteKind;
  note: string;
  updated_at: string;
}

interface PaperVersionDbRow {
  id: string;
  paper_id: string;
  question_count: number;
  total_score: number;
}

interface PaperDbRow {
  id: string;
  title: string;
}

interface QuestionResultDbRow {
  activity_registration_id: string;
  question_id: string;
  outcome: TeacherAssessmentOutcome | null;
  note: string;
}

interface QuestionDbRow {
  id: string;
  question_no: string;
  knowledge_point: string;
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
    "id,student_id,lead_id,status,outcome,assessment_paper_version_id,assessment_started_at,assessment_completed_at,updated_at,",
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
  const paperVersionIds = [...new Set(registrations
    .map(({ registration }) => registration.assessment_paper_version_id)
    .filter((id): id is string => Boolean(id)))];
  const sourceInvitationIds = [...new Set(activities
    .map((activity) => activity.source_invitation_id)
    .filter((id): id is string => Boolean(id)))];

  const [
    assessmentResult,
    routeResult,
    historicalInvitationResult,
    paperVersionResult,
    questionResult,
  ] = await Promise.all([
    registrationIds.length > 0
      ? from(supabase)("assessment_results")
          .select("id,activity_registration_id,assessment_band,score,strengths,focus_areas,parent_concerns,teacher_recommendation,recommended_class,teacher_observation,updated_at,assessor:profiles!assessment_results_assessed_by_fkey(id,display_name)")
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
    paperVersionIds.length > 0
      ? from(supabase)("assessment_paper_versions")
          .select("id,paper_id,question_count,total_score")
          .in("id", paperVersionIds)
          .returns<PaperVersionDbRow[]>()
      : Promise.resolve({ data: [] as PaperVersionDbRow[], error: null }),
    registrationIds.length > 0
      ? from(supabase)("assessment_question_results")
          .select("activity_registration_id,question_id,outcome,note")
          .in("activity_registration_id", registrationIds)
          .returns<QuestionResultDbRow[]>()
      : Promise.resolve({ data: [] as QuestionResultDbRow[], error: null }),
  ]);
  if (assessmentResult.error) throw new Error(assessmentResult.error.message);
  if (routeResult.error) throw new Error(routeResult.error.message);
  if (historicalInvitationResult.error) throw new Error(historicalInvitationResult.error.message);
  if (paperVersionResult.error) throw new Error(paperVersionResult.error.message);
  if (questionResult.error) throw new Error(questionResult.error.message);

  const paperIds = [...new Set((paperVersionResult.data ?? []).map((row) => row.paper_id))];
  const questionIds = [...new Set((questionResult.data ?? []).map((row) => row.question_id))];
  const [paperResult, questionDefinitionResult] = await Promise.all([
    paperIds.length > 0
      ? from(supabase)("assessment_papers")
          .select("id,title")
          .in("id", paperIds)
          .returns<PaperDbRow[]>()
      : Promise.resolve({ data: [] as PaperDbRow[], error: null }),
    questionIds.length > 0
      ? from(supabase)("assessment_paper_questions")
          .select("id,question_no,knowledge_point")
          .in("id", questionIds)
          .returns<QuestionDbRow[]>()
      : Promise.resolve({ data: [] as QuestionDbRow[], error: null }),
  ]);
  if (paperResult.error) throw new Error(paperResult.error.message);
  if (questionDefinitionResult.error) throw new Error(questionDefinitionResult.error.message);

  const assessments = new Map<string, AssessmentWorkbenchAssessment>();
  const assessmentAssessorNames = new Map<string, string>();
  const assessmentAssessorIds = new Map<string, string>();
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
      teacherObservation: row.teacher_observation,
      updatedAt: row.updated_at,
    });
    assessmentAssessorNames.set(row.activity_registration_id, row.assessor?.display_name ?? "");
    if (row.assessor?.id) assessmentAssessorIds.set(row.activity_registration_id, row.assessor.id);
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

  const paperById = new Map((paperResult.data ?? []).map((row) => [row.id, row]));
  const versionById = new Map((paperVersionResult.data ?? []).map((row) => [row.id, row]));
  const questionById = new Map((questionDefinitionResult.data ?? []).map((row) => [row.id, row]));
  const questionResultsByRegistration = new Map<string, QuestionResultDbRow[]>();
  for (const result of questionResult.data ?? []) {
    const values = questionResultsByRegistration.get(result.activity_registration_id) ?? [];
    values.push(result);
    questionResultsByRegistration.set(result.activity_registration_id, values);
  }

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
      assessorId: invitation.assessor_id,
      assessorName: invitation.assessor?.display_name ?? "",
      assessorSource: "assigned",
      background: invitation.summary,
      participationStatus: "booked",
      assessmentStartedAt: null,
      assessmentCompletedAt: null,
      assessment: null,
      questionSummary: null,
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
      const completed = Boolean(registration.assessment_completed_at)
        || Boolean(assessment && !registration.assessment_started_at);
      const actualAssessorId = assessmentAssessorIds.get(registration.id) ?? null;
      const actualAssessorName = assessmentAssessorNames.get(registration.id) ?? "";
      const version = registration.assessment_paper_version_id
        ? versionById.get(registration.assessment_paper_version_id)
        : undefined;
      const paper = version ? paperById.get(version.paper_id) : undefined;
      const questionResults = questionResultsByRegistration.get(registration.id) ?? [];
      const questionSummary = version
        ? buildQuestionSummary(version, paper?.title ?? "", questionResults, questionById)
        : null;
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
        assessorId: completed && actualAssessorId ? actualAssessorId : invitation?.assessor_id ?? actualAssessorId,
        assessorName: completed && actualAssessorName
          ? actualAssessorName
          : invitation?.assessor?.display_name || actualAssessorName,
        assessorSource: completed && actualAssessorName ? "actual" : "assigned",
        background: invitation?.summary || registration.outcome || student?.remark || "",
        participationStatus: registration.status,
        assessmentStartedAt: registration.assessment_started_at,
        assessmentCompletedAt: registration.assessment_completed_at,
        assessment,
        questionSummary,
        route,
        updatedAt: assessment?.updatedAt || route?.updatedAt || registration.updated_at,
      };
    });

  return [...pendingRows, ...materializedRows];
}

function buildQuestionSummary(
  version: PaperVersionDbRow,
  paperTitle: string,
  results: readonly QuestionResultDbRow[],
  questionById: ReadonlyMap<string, QuestionDbRow>,
): AssessmentWorkbenchQuestionSummary {
  const outcomeCounts = Object.fromEntries(
    TEACHER_ASSESSMENT_OUTCOMES.map((outcome) => [outcome, 0]),
  ) as Record<TeacherAssessmentOutcome, number>;
  for (const result of results) {
    if (result.outcome) outcomeCounts[result.outcome] += 1;
  }
  return {
    paperTitle,
    answeredCount: results.filter((result) => result.outcome).length,
    questionCount: version.question_count,
    totalScore: version.total_score,
    outcomeCounts,
    keyNotes: results.flatMap((result) => {
      if (!result.note) return [];
      const question = questionById.get(result.question_id);
      return [{
        questionNo: question?.question_no ?? "-",
        knowledgePoint: question?.knowledge_point ?? "",
        note: result.note,
      }];
    }),
  };
}

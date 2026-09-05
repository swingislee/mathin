import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ActivityKind } from "./activity-kinds";
import type { PublicClassPresence } from "./public-class";
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
  kind: ActivityKind;
  title: string;
  scheduled_at: string;
  location: string;
  source_invitation_id: string | null;
}
interface RegistrationDbRow {
  id: string;
  activity_id: string;
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

interface PublicClassSegmentDbRow {
  id: string;
  activity_id: string;
  kind: string;
  title: string;
  scheduled_at: string;
  location: string;
  primary_teacher_id: string | null;
  primary_teacher: { display_name: string } | null;
}

interface PublicClassRecordDbRow {
  id: string;
  segment_id: string;
  registration_id: string;
  student_presence: PublicClassPresence;
  guardian_presence: PublicClassPresence;
  learning_observation: string;
  assessment_summary: string;
  parent_feedback: string;
  recommendation: string;
  updated_at: string;
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
  range(from: number, to: number): UntypedPostgrestFilter;
  returns<T>(): PromiseLike<UntypedPostgrestResult<T>>;
}

interface UntypedPostgrestQuery {
  select(columns: string): UntypedPostgrestFilter;
}

type UntypedFrom = (relation: string) => UntypedPostgrestQuery;

function from(supabase: { from: unknown }): UntypedFrom {
  return (supabase.from as UntypedFrom).bind(supabase);
}

const READ_PAGE_SIZE = 200;
const RELATED_BATCH_SIZE = 80;

async function readAllRows<T>(buildQuery: () => UntypedPostgrestFilter): Promise<UntypedPostgrestResult<T[]>> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += READ_PAGE_SIZE) {
    const result = await buildQuery().order("id", { ascending: true }).range(offset, offset + READ_PAGE_SIZE - 1).returns<T[]>();
    if (result.error) return result;
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < READ_PAGE_SIZE) return { data: rows, error: null };
  }
}

async function readRelatedRows<T>(
  supabase: { from: unknown }, relation: string, columns: string, key: string, ids: readonly string[],
): Promise<UntypedPostgrestResult<T[]>> {
  const rows: T[] = [];
  const uniqueIds = [...new Set(ids)];
  for (let offset = 0; offset < uniqueIds.length; offset += RELATED_BATCH_SIZE) {
    const batch = uniqueIds.slice(offset, offset + RELATED_BATCH_SIZE);
    const result = await readAllRows<T>(() => from(supabase)(relation).select(columns).in(key, batch));
    if (result.error) return result;
    rows.push(...(result.data ?? []));
  }
  return { data: rows, error: null };
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
  "kind",
  "title",
  "scheduled_at",
  "location",
  "source_invitation_id",
].join(",");

const REGISTRATION_COLUMNS = [
  "id,activity_id,student_id,lead_id,status,outcome,assessment_paper_version_id,assessment_started_at,assessment_completed_at,updated_at",
  "students(id,name,phone,parent_phone,grade,remark)",
  "leads(id,provisional_student_name,phone,grade_hint,grade_text,student_id)",
].join(",");

export async function listAssessmentWorkbenchRows(): Promise<AssessmentWorkbenchRow[]> {
  const supabase = await createClient();
  const [activityResult, confirmedInvitationResult] = await Promise.all([
    readAllRows<ActivityDbRow>(() => from(supabase)("activities")
      .select(ACTIVITY_COLUMNS)
      .is("deleted_at", null)
      .order("scheduled_at", { ascending: true })),
    readAllRows<InvitationDbRow>(() => from(supabase)("lead_invitation_threads")
      .select(INVITATION_COLUMNS)
      .eq("kind", "assessment_1v1")
      .eq("state", "confirmed")
      .order("scheduled_at", { ascending: true })),
  ]);
  if (activityResult.error) throw new Error(activityResult.error.message);
  if (confirmedInvitationResult.error) throw new Error(confirmedInvitationResult.error.message);

  const activities = activityResult.data ?? [];
  const registrationResult = await readRelatedRows<RegistrationDbRow>(supabase, "activity_registrations", REGISTRATION_COLUMNS, "activity_id", activities.map((activity) => activity.id));
  if (registrationResult.error) throw new Error(registrationResult.error.message);
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  const registrations = (registrationResult.data ?? []).flatMap((registration) => {
    const activity = activityById.get(registration.activity_id);
    return activity ? [{ activity, registration }] : [];
  });
  const registrationIds = registrations.map(({ registration }) => registration.id);
  const publicClassActivityIds = activities.filter((activity) => activity.kind === "public_class").map((activity) => activity.id);
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
    publicClassSegmentResult,
    publicClassRecordResult,
  ] = await Promise.all([
    readRelatedRows<AssessmentDbRow>(supabase, "assessment_results", "id,activity_registration_id,assessment_band,score,strengths,focus_areas,parent_concerns,teacher_recommendation,recommended_class,teacher_observation,updated_at,assessor:profiles!assessment_results_assessed_by_fkey(id,display_name)", "activity_registration_id", registrationIds),
    readRelatedRows<RouteDbRow>(supabase, "activity_routes", "id,activity_registration_id,route,note,updated_at", "activity_registration_id", registrationIds),
    readRelatedRows<InvitationDbRow>(supabase, "lead_invitation_threads", INVITATION_COLUMNS, "id", sourceInvitationIds),
    readRelatedRows<PaperVersionDbRow>(supabase, "assessment_paper_versions", "id,paper_id,question_count,total_score", "id", paperVersionIds),
    readRelatedRows<QuestionResultDbRow>(supabase, "assessment_question_results", "activity_registration_id,question_id,outcome,note", "activity_registration_id", registrationIds),
    readRelatedRows<PublicClassSegmentDbRow>(supabase, "public_class_segments", "id,activity_id,kind,title,scheduled_at,location,primary_teacher_id,primary_teacher:profiles!public_class_segments_primary_teacher_id_fkey(display_name)", "activity_id", publicClassActivityIds),
    readRelatedRows<PublicClassRecordDbRow>(supabase, "public_class_participant_records", "id,segment_id,registration_id,student_presence,guardian_presence,learning_observation,assessment_summary,parent_feedback,recommendation,updated_at", "activity_id", publicClassActivityIds),
  ]);
  if (assessmentResult.error) throw new Error(assessmentResult.error.message);
  if (routeResult.error) throw new Error(routeResult.error.message);
  if (historicalInvitationResult.error) throw new Error(historicalInvitationResult.error.message);
  if (paperVersionResult.error) throw new Error(paperVersionResult.error.message);
  if (questionResult.error) throw new Error(questionResult.error.message);
  if (publicClassSegmentResult.error) throw new Error(publicClassSegmentResult.error.message);
  if (publicClassRecordResult.error) throw new Error(publicClassRecordResult.error.message);

  const paperIds = [...new Set((paperVersionResult.data ?? []).map((row) => row.paper_id))];
  const questionIds = [...new Set((questionResult.data ?? []).map((row) => row.question_id))];
  const [paperResult, questionDefinitionResult] = await Promise.all([
    readRelatedRows<PaperDbRow>(supabase, "assessment_papers", "id,title", "id", paperIds),
    readRelatedRows<QuestionDbRow>(supabase, "assessment_paper_questions", "id,question_no,knowledge_point", "id", questionIds),
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
      assessmentKind: "one_to_one",
      activityId: null,
      activityTitle: "",
      publicClassRecord: null,
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
        assessmentKind: activity.kind === "assessment_1v1" ? "one_to_one" : "activity",
        activityId: activity.id,
        activityTitle: activity.title,
        publicClassRecord: null,
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

  const recordsByKey = new Map((publicClassRecordResult.data ?? []).map((record) => [
    `${record.segment_id}:${record.registration_id}`, record,
  ]));
  const publicClassRows = materializedRows.flatMap((row): AssessmentWorkbenchRow[] => {
    const segments = (publicClassSegmentResult.data ?? []).filter((segment) => segment.activity_id === row.activityId);
    return segments.flatMap((segment) => {
      const record = recordsByKey.get(`${segment.id}:${row.registrationId}`);
      if (segment.kind !== "group_assessment" && !record?.assessment_summary.trim()) return [];
      const completed = Boolean(record?.assessment_summary.trim());
      return [{
        ...row,
        id: `segment:${segment.id}:${row.registrationId}`,
        scheduledAt: segment.scheduled_at,
        location: segment.location || row.location,
        assessorId: segment.primary_teacher_id,
        assessorName: segment.primary_teacher?.display_name ?? row.assessorName,
        assessorSource: "assigned",
        assessmentStartedAt: null,
        assessmentCompletedAt: completed ? record!.updated_at : null,
        assessment: completed ? {
          id: record!.id,
          assessmentBand: null,
          score: null,
          strengths: record!.learning_observation,
          focusAreas: "",
          parentConcerns: record!.parent_feedback,
          teacherRecommendation: record!.recommendation,
          recommendedClass: "",
          teacherObservation: record!.assessment_summary,
          updatedAt: record!.updated_at,
        } : null,
        questionSummary: null,
        publicClassRecord: {
          id: record?.id ?? null,
          segmentId: segment.id,
          segmentTitle: segment.title,
          studentPresence: record?.student_presence ?? (segment.kind === "parent_talk" ? "not_applicable" : "expected"),
          guardianPresence: record?.guardian_presence ?? (segment.kind === "parent_talk" ? "expected" : "not_applicable"),
          learningObservation: record?.learning_observation ?? "",
          assessmentSummary: record?.assessment_summary ?? "",
          parentFeedback: record?.parent_feedback ?? "",
          recommendation: record?.recommendation ?? "",
        },
        updatedAt: record?.updated_at ?? row.updatedAt,
      }];
    });
  });
  const segmentedRegistrationIds = new Set(publicClassRows.map((row) => row.registrationId));
  return [...pendingRows, ...materializedRows.filter((row) => !segmentedRegistrationIds.has(row.registrationId)), ...publicClassRows];
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

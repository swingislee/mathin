import "server-only";

import { createClient } from "@/lib/supabase/server";
import { assessmentReadFrom as from, readAllAssessmentRows as readAllRows, readRelatedAssessmentRows as readRelatedRows } from "./assessment-workbench-read";
import { readSchoolQueryBatches } from "./school-query-pages";
import { assessmentSourceOrder } from "./assessment-source-order";
import { assessmentWorkbenchHasFinalResult } from "./assessment-workbench-contract";
import type { ActivityKind } from "./activity-kinds";
import { mergeSourceNotes, normalizeSourceAssessmentBand, sourceAssessmentNote, sourceStaffLabel, resolveSourceStaffId, hasSourceAssessmentConclusion,readSourceEnrollmentFacts } from './business-source-contract';
import {sourceCompletionSummary} from './source-completion-contract';
import { ASSESSMENT_WORKFLOW_COLUMNS } from "./assessment-workflow-data";
import { assessmentWorkflowFromDb, type AssessmentWorkflowDbRow } from "./assessment-workflow-contract";
import type { PublicClassPresence } from "./public-class";
import { REQUIRE_TEACHER_ASSESSMENT_FLAG, type AssessmentQuickEntry, type AssessmentQuickEntryValues, type AssessmentEntryActor } from "./assessment-quick-entry-contract";
import type { ActivityRouteKind, StoredAssessmentBand } from "./activity-workflow-contract";
import type {
  AssessmentWorkbenchAssessment,
  AssessmentWorkbenchFollowUp,
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
  owner_id: string | null;
}
interface StudentSubjectRow {
  id: string;
  name: string;
  phone: string;
  parent_phone: string;
  grade: number | null;
  remark: string;
  assigned_to: string | null;
}

interface SupportOwnerDbRow {id:string;display_name:string;role:string;is_active:boolean;account_status:string}

interface InvitationDbRow {
  id: string;
  state: string;
  rescheduled_at: string | null;
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
  rescheduled_at: string | null;
  kind: ActivityKind;
  title: string;
  scheduled_at: string | null;
  occurred_on: string | null;
  record_state: 'current' | 'historical';
  location: string;
  remark: string;
  source_invitation_id: string | null;
}
interface RegistrationDbRow {
  source_enrollment_facts: unknown;
  source_record_id: string | null;
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
  assessed_on: string | null;
  activity_registration_id: string;
  assessment_band: StoredAssessmentBand | null;
  score: number | null;
  score_max: number | null;
  strengths: string;
  focus_areas: string;
  parent_concerns: string;
  teacher_recommendation: string;
  recommended_class: string;
  teacher_observation: string;
  updated_at: string;
  assessor: { id: string; display_name: string } | null;
  result_source: "legacy" | "quick_entry" | "teacher";
  result_finalized_at: string | null;
}

interface QuickEntryDbRow {
  id: string; registration_id: string; entry: AssessmentQuickEntryValues; revision: number;
  recorded_by: string; updated_at: string; finalized_at: string | null;
  recorder: { display_name: string } | null;
}
interface EntryActorDbRow {
  id: string; registration_id: string; entry_kind: "quick_entry" | "teacher";
  recorded_by: string; recorded_at: string; display_name: string;
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
  enrollment: { id: string; status: "active" | "cancelled" } | null;
}

interface FollowUpDbRow {
  record_state: 'current' | 'historical';
  id: string;
  student_id: string;
  content: string;
  kind: string;
  next_follow_up_at: string | null;
  status_after: string | null;
  created_at: string;
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

const INVITATION_COLUMNS = [
  "state,rescheduled_at",
  "id",
  "lead_id",
  "assessor_id",
  "scheduled_at",
  "location_text",
  "summary",
  "updated_at",
  "leads(id,provisional_student_name,phone,grade_hint,grade_text,student_id,owner_id)",
  "assessor:profiles!lead_invitation_threads_assessor_id_fkey(display_name)",
].join(",");

const ACTIVITY_COLUMNS = [
  "rescheduled_at",
  "id",
  "record_state,occurred_on",
  "kind",
  "title",
  "scheduled_at",
  "location",
  "remark",
  "source_invitation_id",
].join(",");

const REGISTRATION_COLUMNS = [
  "id,activity_id,student_id,lead_id,source_record_id,source_enrollment_facts,status,outcome,assessment_paper_version_id,assessment_started_at,assessment_completed_at,updated_at",
  "students(id,name,phone,parent_phone,grade,remark,assigned_to)",
  "leads(id,provisional_student_name,phone,grade_hint,grade_text,student_id,owner_id)",
].join(",");

export async function listAssessmentWorkbenchRows(subject?: { studentId: string | null; leadId: string | null }): Promise<AssessmentWorkbenchRow[]> {
  const supabase = await createClient();
  let subjectLeadIds: string[] | undefined, subjectActivityIds: string[] | undefined, subjectRegistrationIds: string[] | undefined;
  if (subject) {
    if (!subject.studentId && !subject.leadId) return [];
    const leadResult = await readAllRows<{ id: string }>(() => {
      const query = from(supabase)("leads").select("id");
      return subject.studentId ? query.eq("student_id", subject.studentId) : query.eq("id", subject.leadId);
    });
    if (leadResult.error) throw new Error(leadResult.error.message);
    subjectLeadIds = [...new Set([...(leadResult.data ?? []).map(row => row.id), ...(subject.leadId ? [subject.leadId] : [])])];
    const clauses = [...(subject.studentId ? [`student_id.eq.${subject.studentId}`] : []),
      ...(subjectLeadIds.length ? [`lead_id.in.(${subjectLeadIds.join(",")})`] : [])];
    const registrations = clauses.length ? await readAllRows<{ id: string; activity_id: string }>(() => from(supabase)("business_activity_registrations")
      .select("id,activity_id").or(clauses.join(","))) : { data: [], error: null };
    if (registrations.error) throw new Error(registrations.error.message);
    subjectRegistrationIds = (registrations.data ?? []).map(row => row.id);
    subjectActivityIds = [...new Set((registrations.data ?? []).map(row => row.activity_id))];
  }
  const [activityResult, confirmedInvitationResult, requiredResult, orderResult] = await Promise.all([
    subjectActivityIds ? readRelatedRows<ActivityDbRow>(supabase, "business_activities", ACTIVITY_COLUMNS, "id", subjectActivityIds,
      query => query.is("deleted_at", null))
      : readAllRows<ActivityDbRow>(() => from(supabase)("business_activities")
      .select(ACTIVITY_COLUMNS)
      .is("deleted_at", null)),
    subjectLeadIds?.length === 0 ? Promise.resolve({ data: [] as InvitationDbRow[], error: null }) : readAllRows<InvitationDbRow>(() => {
      let query = from(supabase)("lead_invitation_threads")
      .select(INVITATION_COLUMNS)
      .eq("kind", "assessment_1v1")
      .in("state", ["confirmed", "cancelled"]);
      if (subjectLeadIds) query = query.in("lead_id", subjectLeadIds);
      return query;
    }),
    supabase.rpc("is_feature_enabled", { p_flag_key: REQUIRE_TEACHER_ASSESSMENT_FLAG }),
    subject ? Promise.resolve({ data: [] as { id: string }[], error: null }) : readAllRows<{ id: string }>(() => from(supabase)("assessment_workbench_read_order")
      .select("id")
      .order("assessment_at", { ascending: false, nullsFirst: false })),
  ]);
  if (activityResult.error) throw new Error(activityResult.error.message);
  if (confirmedInvitationResult.error) throw new Error(confirmedInvitationResult.error.message);
  if (requiredResult.error) throw new Error(requiredResult.error.message);
  if (orderResult.error) throw new Error("ASSESSMENT_SOURCE_ORDER_READ");

  const activities = (activityResult.data ?? []);
  const registrationResult = await readRelatedRows<RegistrationDbRow>(supabase, "business_activity_registrations", REGISTRATION_COLUMNS,
    subjectRegistrationIds ? "id" : "activity_id", subjectRegistrationIds ?? activities.map((activity) => activity.id));
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
  const followUpStudentIds = [...new Set([
    ...registrations.map(({ registration }) => registration.student_id),
    ...(confirmedInvitationResult.data ?? []).map((invitation) => invitation.leads?.student_id ?? null),
  ].filter((id): id is string => Boolean(id)))];
  const linkedStudentIds=[...new Set([...registrations.map(({registration})=>registration.leads?.student_id),...(confirmedInvitationResult.data??[]).map(invitation=>invitation.leads?.student_id)].filter((id):id is string=>Boolean(id)))];
  const sourceSupportByActivity=new Map(activities.map(activity=>[activity.id,sourceStaffLabel(activity.remark,'学服老师')]));
  const missingSourceIds=[...new Set(registrations.filter(({activity})=>!sourceSupportByActivity.get(activity.id))
    .map(({registration})=>registration.source_record_id).filter((id):id is string=>Boolean(id)))];
  const [linkedStudentOwnerResult,sourceResult]=await Promise.all([
    readRelatedRows<{id:string;assigned_to:string|null}>(supabase,'students','id,assigned_to','id',linkedStudentIds),
    // 来源 RPC 每个 ID 至多一行；共用助手每批 80 个、最多同时读取四批。
    readSchoolQueryBatches(missingSourceIds,batch=>supabase.rpc('get_business_source_records',{p_ids:batch})),
  ]);
  if(linkedStudentOwnerResult.error)throw new Error('ASSESSMENT_LINKED_STUDENT_OWNER_READ');
  if(sourceResult.error)throw new Error('ASSESSMENT_SOURCE_SUPPORT_READ');
  const linkedStudentOwners=new Map((linkedStudentOwnerResult.data??[]).map(student=>[student.id,student.assigned_to]));
  const supportOwnerIds=[...new Set([...registrations.flatMap(({registration})=>[registration.students?.assigned_to,registration.leads?.owner_id]),...(confirmedInvitationResult.data??[]).map(invitation=>invitation.leads?.owner_id),...linkedStudentOwners.values()].filter((id):id is string=>Boolean(id)))];
  const sourceSupportByRecord=new Map<string,string>();
  for(const source of sourceResult.data??[]){
    const record=source.record_data as {cells?:{fieldName:string;text:string}[]}|null;
    const names=[...new Set((record?.cells??[]).filter(cell=>cell.fieldName==='学服老师').map(cell=>cell.text.trim()).filter(Boolean))];
    if(names.length===1)sourceSupportByRecord.set(source.id,names[0]);
  }
  for(const {activity,registration} of registrations){
    if(!sourceSupportByActivity.get(activity.id)&&registration.source_record_id){
      sourceSupportByActivity.set(activity.id,sourceSupportByRecord.get(registration.source_record_id)??'');
    }
  }
  const sourceSupportNames=[...new Set([...sourceSupportByActivity.values()].filter(Boolean))];

  const [
    assessmentResult,
    routeResult,
    historicalInvitationResult,
    paperVersionResult,
    questionResult,
    publicClassSegmentResult,
    publicClassRecordResult,
    followUpResult,
    quickEntryResult,
    entryActorResult,
    workflowResult,
    supportOwnerResult,
    sourceSupportResult,
  ] = await Promise.all([
    readRelatedRows<AssessmentDbRow>(supabase, "business_assessment_results", "id,activity_registration_id,assessed_on,assessment_band,score,score_max,strengths,focus_areas,parent_concerns,teacher_recommendation,recommended_class,teacher_observation,updated_at,result_source,result_finalized_at,assessor:profiles!assessment_results_assessed_by_fkey(id,display_name)", "activity_registration_id", registrationIds),
    readRelatedRows<RouteDbRow>(supabase, "activity_routes", "id,activity_registration_id,route,note,updated_at,enrollment:course_enrollments!activity_routes_course_enrollment_id_fkey(id,status)", "activity_registration_id", registrationIds),
    readRelatedRows<InvitationDbRow>(supabase, "lead_invitation_threads", INVITATION_COLUMNS, "id", sourceInvitationIds),
    readRelatedRows<PaperVersionDbRow>(supabase, "assessment_paper_versions", "id,paper_id,question_count,total_score", "id", paperVersionIds),
    readRelatedRows<QuestionResultDbRow>(supabase, "assessment_question_results", "activity_registration_id,question_id,outcome,note", "activity_registration_id", registrationIds),
    readRelatedRows<PublicClassSegmentDbRow>(supabase, "public_class_segments", "id,activity_id,kind,title,scheduled_at,location,primary_teacher_id,primary_teacher:profiles!public_class_segments_primary_teacher_id_fkey(display_name)", "activity_id", publicClassActivityIds),
    readRelatedRows<PublicClassRecordDbRow>(supabase, "public_class_participant_records", "id,segment_id,registration_id,student_presence,guardian_presence,learning_observation,assessment_summary,parent_feedback,recommendation,updated_at", "activity_id", publicClassActivityIds),
    readRelatedRows<FollowUpDbRow>(supabase, "business_student_follow_ups", "id,student_id,content,kind,next_follow_up_at,status_after,created_at,record_state", "student_id", followUpStudentIds),
    readRelatedRows<QuickEntryDbRow>(supabase, "assessment_quick_entries", "id,registration_id,entry,revision,recorded_by,updated_at,finalized_at,recorder:profiles!assessment_quick_entries_recorded_by_fkey(display_name)", "registration_id", registrationIds),
    readRelatedRows<EntryActorDbRow>(supabase, "assessment_entry_actors", "id,registration_id,entry_kind,recorded_by,recorded_at,display_name", "registration_id", registrationIds),
    readRelatedRows<AssessmentWorkflowDbRow>(supabase, "assessment_workflow_states", ASSESSMENT_WORKFLOW_COLUMNS, "registration_id", registrationIds),
    readRelatedRows<SupportOwnerDbRow>(supabase,'profiles','id,display_name,role,is_active,account_status','id',supportOwnerIds),
    readRelatedRows<SupportOwnerDbRow>(supabase,'profiles','id,display_name,role,is_active,account_status','display_name',sourceSupportNames),
  ]);
  if (assessmentResult.error) throw new Error(assessmentResult.error.message);
  if (routeResult.error) throw new Error(routeResult.error.message);
  if (historicalInvitationResult.error) throw new Error(historicalInvitationResult.error.message);
  if (paperVersionResult.error) throw new Error(paperVersionResult.error.message);
  if (questionResult.error) throw new Error(questionResult.error.message);
  if (publicClassSegmentResult.error) throw new Error(publicClassSegmentResult.error.message);
  if (publicClassRecordResult.error) throw new Error(publicClassRecordResult.error.message);
  if (followUpResult.error) throw new Error(followUpResult.error.message);
  if (quickEntryResult.error) throw new Error(quickEntryResult.error.message);
  if (entryActorResult.error) throw new Error(entryActorResult.error.message);
  if (workflowResult.error) throw new Error(workflowResult.error.message);
  if(supportOwnerResult.error||sourceSupportResult.error)throw new Error('ASSESSMENT_SUPPORT_OWNER_READ');
  const supportOwners=new Map([...supportOwnerResult.data??[],...sourceSupportResult.data??[]].map(profile=>[profile.id,profile.display_name]));
  const workflows = new Map((workflowResult.data ?? []).map((row) => [row.registration_id, assessmentWorkflowFromDb(row)]));

  const quickEntries = new Map<string, AssessmentQuickEntry>((quickEntryResult.data ?? []).map((entry) => [entry.registration_id, {
    id: entry.id, values: entry.entry, revision: entry.revision, recordedBy: entry.recorded_by,
    recordedByName: entry.recorder?.display_name ?? "", updatedAt: entry.updated_at, finalizedAt: entry.finalized_at,
  }]));
  const entryActors = new Map<string, AssessmentEntryActor[]>();
  for (const actor of entryActorResult.data ?? []) {
    entryActors.set(actor.registration_id, [...entryActors.get(actor.registration_id) ?? [], {
      id: actor.recorded_by, name: actor.display_name, kind: actor.entry_kind, recordedAt: actor.recorded_at,
    }]);
  }

  const paperIds = [...new Set((paperVersionResult.data ?? []).map((row) => row.paper_id))];
  const questionIds = [...new Set((questionResult.data ?? []).map((row) => row.question_id))];
  const [paperResult, questionDefinitionResult] = await Promise.all([
    readRelatedRows<PaperDbRow>(supabase, "assessment_papers", "id,title", "id", paperIds),
    readRelatedRows<QuestionDbRow>(supabase, "assessment_paper_questions", "id,question_no,knowledge_point", "id", questionIds),
  ]);
  if (paperResult.error) throw new Error(paperResult.error.message);
  if (questionDefinitionResult.error) throw new Error(questionDefinitionResult.error.message);

  const assessments = new Map<string, AssessmentWorkbenchAssessment>();
  const assessmentDates = new Map((assessmentResult.data ?? []).map(row => [row.activity_registration_id, row.assessed_on]));
  const assessmentAssessorNames = new Map<string, string>();
  const assessmentAssessorIds = new Map<string, string>();
  for (const row of assessmentResult.data ?? []) {
    assessments.set(row.activity_registration_id, {
      id: row.id,
      assessmentBand: normalizeSourceAssessmentBand(row.assessment_band),
      score: row.score,
      scoreMax: row.score_max,
      strengths: mergeSourceNotes(row.strengths,sourceAssessmentNote(row.assessment_band)),
      focusAreas: row.focus_areas,
      parentConcerns: row.parent_concerns,
      teacherRecommendation: row.teacher_recommendation,
      recommendedClass: row.recommended_class,
      teacherObservation: row.teacher_observation,
      updatedAt: row.updated_at,
      resultSource: row.result_source,
      finalizedAt: row.result_finalized_at,
      recordedByName: row.assessor?.display_name ?? "",
    });
    if (row.result_source !== "quick_entry") {
      assessmentAssessorNames.set(row.activity_registration_id, row.assessor?.display_name ?? "");
      if (row.assessor?.id) assessmentAssessorIds.set(row.activity_registration_id, row.assessor.id);
    }
  }
  const routes = new Map<string, AssessmentWorkbenchRoute>();
  const enrollmentsByRegistration = new Map<string, string>();
  for (const row of routeResult.data ?? []) {
    if (row.enrollment?.status === "active") enrollmentsByRegistration.set(row.activity_registration_id, row.enrollment.id);
    routes.set(row.activity_registration_id, {
      id: row.id,
      route: row.route,
      note: row.note,
      updatedAt: row.updated_at,
    });
  }
  const latestFollowUps = new Map<string, AssessmentWorkbenchFollowUp>();
  for (const row of followUpResult.data ?? []) {
    if (row.record_state === 'historical') continue;
    const current = latestFollowUps.get(row.student_id);
    if (!current || row.created_at > current.createdAt) {
      latestFollowUps.set(row.student_id, {
        id: row.id,
        content: row.content,
        kind: row.kind,
        createdAt: row.created_at,
        nextFollowUpAt: row.next_follow_up_at,
        statusAfter: row.status_after,
      });
    }
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
      rescheduledAt: invitation.rescheduled_at ?? null,
      location: invitation.location_text,
      assessorId: invitation.assessor_id,
      assessorName: invitation.assessor?.display_name ?? "",
      assessorSource: "assigned",
      supportOwnerId:linkedStudentOwners.get(invitation.leads?.student_id??'')??invitation.leads?.owner_id??null,
      supportOwnerName:supportOwners.get(linkedStudentOwners.get(invitation.leads?.student_id??'')??invitation.leads?.owner_id??'')??'',
      background: invitation.summary,
      participationStatus: invitation.state === "cancelled" ? "cancelled" : "booked",
      assessmentStartedAt: null,
      assessmentCompletedAt: null,
      assessment: null,
      teacherRequired: requiredResult.data,
      quickEntry: null,
      questionSummary: null,
      route: null,
      latestFollowUp: invitation.leads?.student_id ? latestFollowUps.get(invitation.leads.student_id) ?? null : null,
      updatedAt: invitation.updated_at,
    }));

  const materializedRows = registrations
    .map(({ activity, registration }): AssessmentWorkbenchRow => {
      const invitation = activity.source_invitation_id
        ? invitations.get(activity.source_invitation_id)
        : undefined;
      const student = registration.students;
      const lead = registration.leads ?? invitation?.leads ?? null;
      const assessment = assessments.get(registration.id) ?? null;
      const sourceSupportName=sourceSupportByActivity.get(activity.id)??'';
      const supportOwnerId=student?.assigned_to??linkedStudentOwners.get(lead?.student_id??'')??lead?.owner_id??resolveSourceStaffId(sourceSupportName,sourceSupportResult.data??[]);
      const route = routes.get(registration.id) ?? null;
      const completed = Boolean(registration.assessment_completed_at)
        || Boolean(assessment && assessment.resultSource !== "quick_entry" && !registration.assessment_started_at && (!registration.source_record_id || registration.status==='attended' && hasSourceAssessmentConclusion(assessment,registration.status)));
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
        id: activity.source_invitation_id ? `invitation:${activity.source_invitation_id}` : `registration:${registration.id}`,
        assessmentKind: activity.kind === "assessment_1v1" ? "one_to_one" : "activity",
        activityId: activity.id,
        activityTitle: activity.title,
        publicClassRecord: null,
        invitationId: activity.source_invitation_id,
        registrationId: registration.id,
        enrollmentId: enrollmentsByRegistration.get(registration.id) ?? null,
        paperVersionId: registration.assessment_paper_version_id,
        sourceRecordId: registration.source_record_id,
        sourceEnrollmentFacts: readSourceEnrollmentFacts(registration.source_enrollment_facts),
        studentId: registration.student_id ?? lead?.student_id ?? null,
        leadId: registration.lead_id,
        name: student?.name ?? lead?.provisional_student_name ?? "-",
        phone: student?.parent_phone || student?.phone || lead?.phone || "",
        grade: student?.grade ?? lead?.grade_hint ?? null,
        gradeText: lead?.grade_text ?? "",
        scheduledAt: activity.scheduled_at ?? '',
        rescheduledAt: [activity.rescheduled_at, invitation?.rescheduled_at].filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
        recordState: activity.record_state,
        occurredOn: assessmentDates.get(registration.id) ?? activity.occurred_on,
        location: activity.location,
        assessorId: completed && actualAssessorId ? actualAssessorId : invitation?.assessor_id ?? actualAssessorId,
        assessorName: completed && actualAssessorName
          ? actualAssessorName
          : invitation?.assessor?.display_name || actualAssessorName,
        assessorSource: completed && actualAssessorName ? "actual" : "assigned",
        supportOwnerId,
        supportOwnerName:supportOwners.get(supportOwnerId??'')||sourceSupportName,
        background: mergeSourceNotes(invitation?.summary,registration.outcome,activity.remark,student?.remark),
        participationStatus: registration.status,
        assessmentStartedAt: registration.assessment_started_at,
        assessmentCompletedAt: registration.assessment_completed_at,
        assessment,
        quickEntry: quickEntries.get(registration.id) ?? null,
        entryActors: entryActors.get(registration.id) ?? [],
        teacherRequired: requiredResult.data,
        workflow: workflows.get(registration.id) ?? null,
        questionSummary,
        route,
        latestFollowUp: registration.student_id ? latestFollowUps.get(registration.student_id) ?? null : null,
        updatedAt: [assessment?.updatedAt, route?.updatedAt, quickEntries.get(registration.id)?.updatedAt, workflows.get(registration.id)?.updatedAt, registration.updated_at]
          .filter((value): value is string => Boolean(value)).sort().at(-1)!,
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
  const rows=[...pendingRows,...materializedRows.filter(row=>!segmentedRegistrationIds.has(row.registrationId)),...publicClassRows];
  const studentIds=[...new Set(rows.map(row=>row.studentId).filter((id):id is string=>Boolean(id)))];
  const [sourceEnrollments,subjectLeads]=await Promise.all([
    readRelatedRows<{id:string;student_id:string;status:string;source_enrollment_facts:unknown}>(supabase,'course_enrollments','id,student_id,status,source_enrollment_facts','student_id',studentIds),
    readRelatedRows<{id:string;student_id:string}>(supabase,'leads','id,student_id','student_id',studentIds),
  ]);
  if(sourceEnrollments.error||subjectLeads.error)throw new Error('ASSESSMENT_SOURCE_COMPLETION_READ');
  const enrollmentByStudent=new Map<string,unknown[]>();
  for(const enrollment of sourceEnrollments.data??[])if(enrollment.status==='active'&&readSourceEnrollmentFacts(enrollment.source_enrollment_facts))
    enrollmentByStudent.set(enrollment.student_id,[...(enrollmentByStudent.get(enrollment.student_id)??[]),enrollment.source_enrollment_facts]);
  const subjectKey=(row:AssessmentWorkbenchRow)=>row.studentId?`student:${row.studentId}`:`lead:${row.leadId}`;
  const groups=new Map<string,AssessmentWorkbenchRow[]>();
  for(const row of rows)groups.set(subjectKey(row),[...(groups.get(subjectKey(row))??[]),row]);
  const relevantLeadIds=[...new Set([...groups.values()].filter(group=>group.some(row=>row.sourceEnrollmentFacts||assessmentWorkbenchHasFinalResult(row))||enrollmentByStudent.has(group[0].studentId??''))
    .flatMap(group=>[...group.map(row=>row.leadId),...(subjectLeads.data??[]).filter(lead=>lead.student_id===group[0].studentId).map(lead=>lead.id)])
    .filter((id):id is string=>Boolean(id)))];
  const contacts=await readRelatedRows<{id:string;lead_id:string;outcome:string|null}>(supabase,'lead_communications','id,lead_id,outcome','lead_id',relevantLeadIds);
  if(contacts.error)throw new Error('ASSESSMENT_SOURCE_CONTACT_READ');
  for(const group of groups.values()){
    const studentId=group[0].studentId;
    const leadIds=new Set([...group.map(row=>row.leadId),...(subjectLeads.data??[]).filter(lead=>lead.student_id===studentId).map(lead=>lead.id)]);
    const summary=sourceCompletionSummary([...group.map(row=>row.sourceEnrollmentFacts),...(enrollmentByStudent.get(studentId??'')??[])],
      (contacts.data??[]).some(contact=>leadIds.has(contact.lead_id)&&['connected','declined'].includes(contact.outcome??'')),
      group.map(row=>({status:row.participationStatus,hasResult:assessmentWorkbenchHasFinalResult(row),
        date:row.occurredOn??row.assessmentCompletedAt??null,band:row.assessment?.assessmentBand??null,score:row.assessment?.score??null,
        teacher:row.assessment?.recordedByName||sourceStaffLabel(row.background,'学科老师')||null})));
    for(const row of group)row.sourceCompletion=summary;
  }
  if (subject) {
    const order = await readRelatedRows<{ id: string; assessment_at: string | null }>(supabase, "assessment_workbench_read_order", "id,assessment_at", "id", rows.map(row => row.id));
    if (order.error) throw new Error("ASSESSMENT_SOURCE_ORDER_READ");
    return assessmentSourceOrder(rows, (order.data ?? []).sort((a, b) => (b.assessment_at ?? "").localeCompare(a.assessment_at ?? "") || a.id.localeCompare(b.id)));
  }
  return assessmentSourceOrder(rows,orderResult.data??[]);
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
    paperVersionId: version.id,
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

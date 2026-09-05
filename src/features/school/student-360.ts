import "server-only";

import type { Database } from "@/lib/database.types";
import { getMyPerms } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { PermissionKey } from "./permissions";
import {
  latestStudent360Phase,
  sortStudent360Events,
  summarizeStudent360Phases,
  type Student360Event,
  type Student360Fact,
  type Student360FactLabel,
  type Student360Note,
  type Student360NoteLabel,
  type Student360Phase,
  type Student360Snapshot,
  type Student360SubjectRef,
} from "./student-360-contract";

type CommercialEnrollmentRow = {
  id: string; note: string; confirmed_by: string; confirmed_at: string;
  cancelled_by: string | null; cancelled_at: string | null;
  courses: { title: string } | null; school_terms: { name: string } | null;
};
type PostActivityContactRow = {
  id: string; registration_id: string; channel: string; outcome: string; note: string;
  next_contact_at: string | null; recorded_by: string; occurred_at: string;
};

type TableName = keyof Database["public"]["Tables"];
type TableRow<Name extends TableName> = Database["public"]["Tables"][Name]["Row"];

type LeadRow = Pick<TableRow<"leads">,
  "id" | "provisional_student_name" | "phone" | "grade_hint" | "grade_text" |
  "status" | "owner_id" | "student_id" | "identity_confirmed_at" | "created_by" | "created_at"
>;
type StudentRow = Pick<TableRow<"students">,
  "id" | "name" | "grade" | "phone" | "wechat" | "school" | "parent_name" |
  "parent_phone" | "assigned_to" | "status" | "follow_up_status" | "remark" |
  "next_follow_up_at" | "updated_at"
>;
type SourceRow = Pick<TableRow<"lead_source_records">,
  "id" | "lead_id" | "submitted_at" | "source_system" | "batch_label" |
  "acquisition_method" | "promoter" | "location_text" | "raw_interest_text" |
  "remark" | "created_at"
>;
type InterestRow = Pick<TableRow<"lead_interest_selections">,
  "id" | "lead_id" | "source_record_id" | "label" | "category" | "created_at"
>;
type CommunicationRow = Pick<TableRow<"lead_communications">,
  "id" | "lead_id" | "channel" | "outcome" | "note" | "wechat_added" |
  "visit_committed" | "interest_level" | "recorded_by" | "occurred_at"
>;
type NextActionRow = Pick<TableRow<"lead_next_actions">,
  "id" | "lead_id" | "kind" | "due_at" | "status" | "created_by" |
  "completed_by" | "completed_at" | "created_at"
>;
type InvitationRow = Pick<TableRow<"lead_invitation_threads">,
  "id" | "lead_id" | "kind" | "state" | "activity_id" | "assessor_id" |
  "proposed_time_text" | "scheduled_at" | "location_text" | "summary" |
  "created_by" | "updated_by" | "created_at" | "updated_at" | "closed_at"
>;
type InvitationEventRow = Pick<TableRow<"lead_invitation_events">,
  "id" | "invitation_id" | "from_state" | "to_state" | "channel" |
  "note" | "recorded_by" | "occurred_at"
>;
type RegistrationRow = Pick<TableRow<"activity_registrations">,
  "id" | "activity_id" | "student_id" | "lead_id" | "status" | "outcome" |
  "operated_by" | "assessment_started_at" | "assessment_completed_at" |
  "created_at" | "updated_at"
>;
type ActivityRow = Pick<TableRow<"activities">,
  "id" | "kind" | "title" | "scheduled_at" | "location" | "remark" |
  "created_by" | "source_invitation_id"
>;
type AssessmentRow = Pick<TableRow<"assessment_results">,
  "id" | "activity_registration_id" | "assessment_band" | "overall_level" |
  "score" | "strengths" | "focus_areas" | "parent_concerns" |
  "teacher_recommendation" | "recommended_class" | "teacher_observation" |
  "assessed_by" | "created_at" | "updated_at"
>;
type RouteRow = Pick<TableRow<"activity_routes">,
  "id" | "activity_registration_id" | "route" | "note" | "routed_by" |
  "created_at" | "updated_at"
>;
type PublicClassRecordRow = Pick<TableRow<"public_class_participant_records">,
  "id" | "activity_id" | "segment_id" | "registration_id" | "student_presence" |
  "guardian_presence" | "learning_observation" | "assessment_summary" |
  "parent_feedback" | "recommendation" | "updated_by" | "created_at" | "updated_at"
>;
type PublicClassSegmentRow = Pick<TableRow<"public_class_segments">,
  "id" | "activity_id" | "kind" | "title" | "scheduled_at" | "location"
>;
type QuestionResultRow = Pick<TableRow<"assessment_question_results">,
  "activity_registration_id" | "question_id" | "outcome" | "note"
>;
type QuestionRow = Pick<TableRow<"assessment_paper_questions">,
  "id" | "question_no" | "knowledge_point"
>;
type FollowUpRow = Pick<TableRow<"student_follow_ups">,
  "id" | "student_id" | "author_id" | "content" | "kind" |
  "next_follow_up_at" | "status_after" | "created_at"
>;
type EnrollmentRow = Pick<TableRow<"enrollments">,
  "id" | "classroom_id" | "student_id" | "status" | "joined_at" | "left_at" |
  "remark" | "operated_by" | "created_at"
>;
type AttendanceRow = Pick<TableRow<"session_attendance">,
  "session_id" | "student_id" | "status" | "note" | "marked_by" | "marked_at"
>;
type ReviewRow = Pick<TableRow<"session_reviews">,
  "session_id" | "student_id" | "entry_score" | "exit_score" | "focus" |
  "participation" | "mastery" | "comment" | "created_by" | "updated_at"
>;
type SessionRow = Pick<TableRow<"class_sessions">,
  "id" | "classroom_id" | "title" | "scheduled_at" | "started_at" | "ended_at"
>;
type ClassroomRow = Pick<TableRow<"classrooms">, "id" | "name">;
type ProfileRow = Pick<TableRow<"profiles">, "id" | "display_name">;

interface ReadResult<T> {
  data: T | null;
  error: { message: string } | null;
}

const READ_LIMIT = 500;
const VIEW_PERMISSIONS: readonly PermissionKey[] = [
  "student.view.all",
  "student.view.assigned",
  "followup.view",
  "activity.manage",
  "activity.register",
  "review.write",
];

async function readRows<T>(query: PromiseLike<ReadResult<T[]>>): Promise<T[]> {
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

async function readMaybe<T>(query: PromiseLike<ReadResult<T>>): Promise<T | null> {
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function compact<T>(items: Array<T | null | undefined | false>): T[] {
  return items.filter((item): item is T => Boolean(item));
}

function fact(
  label: Student360FactLabel,
  value: string | number | null | undefined,
  format: Student360Fact["format"] = "text",
): Student360Fact | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return { label, value: String(value), format };
}

function note(label: Student360NoteLabel, content: string | null | undefined): Student360Note | null {
  const normalized = content?.trim();
  return normalized ? { label, content: normalized } : null;
}

function addEvent(events: Student360Event[], event: Student360Event) {
  events.push({
    ...event,
    facts: event.facts.filter((item) => item.value.trim()),
    notes: event.notes.filter((item) => item.content.trim()),
  });
}

function followUpPhase(kind: string, occurredAt: string, firstEnrollmentAt: string | null): Student360Phase {
  if (kind === "class") return "learning";
  if (kind === "visit" || kind === "activity") return "experience";
  if (kind === "call") return "contact";
  return firstEnrollmentAt && occurredAt >= firstEnrollmentAt ? "learning" : "contact";
}

export async function getStudent360Snapshot(
  subject: Student360SubjectRef,
): Promise<Student360Snapshot> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const permissions = await getMyPerms(user.id);
  if (!VIEW_PERMISSIONS.some((permission) => permissions.has(permission))) {
    throw new Error("FORBIDDEN");
  }

  const directLead = subject.leadId
    ? await readMaybe(supabase.from("leads")
        .select("id,provisional_student_name,phone,grade_hint,grade_text,status,owner_id,student_id,identity_confirmed_at,created_by,created_at")
        .eq("id", subject.leadId)
        .maybeSingle<LeadRow>())
    : null;
  if (subject.studentId && directLead?.student_id && directLead.student_id !== subject.studentId) {
    throw new Error("SUBJECT_MISMATCH");
  }

  const studentId = subject.studentId ?? directLead?.student_id ?? null;
  const student = studentId
    ? await readMaybe(supabase.from("students")
        .select("id,name,grade,phone,wechat,school,parent_name,parent_phone,assigned_to,status,follow_up_status,remark,next_follow_up_at,updated_at")
        .eq("id", studentId)
        .maybeSingle<StudentRow>())
    : null;
  const linkedLeads = studentId
    ? await readRows(supabase.from("leads")
        .select("id,provisional_student_name,phone,grade_hint,grade_text,status,owner_id,student_id,identity_confirmed_at,created_by,created_at")
        .eq("student_id", studentId)
        .order("created_at", { ascending: true })
        .limit(READ_LIMIT)
        .returns<LeadRow[]>())
    : [];
  const leads = [...linkedLeads];
  if (directLead && !leads.some((lead) => lead.id === directLead.id)) leads.push(directLead);
  const leadIds = unique(compact([subject.leadId, ...leads.map((lead) => lead.id)]));

  const [
    sourceRows,
    interestRows,
    communicationRows,
    nextActionRows,
    invitationRows,
    studentRegistrationRows,
    leadRegistrationRows,
    followUpRows,
    enrollmentRows,
    attendanceRows,
    reviewRows,
    commercialEnrollmentRows,
  ] = await Promise.all([
    leadIds.length ? readRows(supabase.from("lead_source_records")
      .select("id,lead_id,submitted_at,source_system,batch_label,acquisition_method,promoter,location_text,raw_interest_text,remark,created_at")
      .in("lead_id", leadIds).order("created_at", { ascending: false }).limit(READ_LIMIT)
      .returns<SourceRow[]>()) : Promise.resolve([]),
    leadIds.length ? readRows(supabase.from("lead_interest_selections")
      .select("id,lead_id,source_record_id,label,category,created_at")
      .in("lead_id", leadIds).order("created_at", { ascending: false }).limit(READ_LIMIT)
      .returns<InterestRow[]>()) : Promise.resolve([]),
    leadIds.length ? readRows(supabase.from("lead_communications")
      .select("id,lead_id,channel,outcome,note,wechat_added,visit_committed,interest_level,recorded_by,occurred_at")
      .in("lead_id", leadIds).order("occurred_at", { ascending: false }).limit(READ_LIMIT)
      .returns<CommunicationRow[]>()) : Promise.resolve([]),
    leadIds.length ? readRows(supabase.from("lead_next_actions")
      .select("id,lead_id,kind,due_at,status,created_by,completed_by,completed_at,created_at")
      .in("lead_id", leadIds).order("created_at", { ascending: false }).limit(READ_LIMIT)
      .returns<NextActionRow[]>()) : Promise.resolve([]),
    leadIds.length ? readRows(supabase.from("lead_invitation_threads")
      .select("id,lead_id,kind,state,activity_id,assessor_id,proposed_time_text,scheduled_at,location_text,summary,created_by,updated_by,created_at,updated_at,closed_at")
      .in("lead_id", leadIds).order("created_at", { ascending: false }).limit(READ_LIMIT)
      .returns<InvitationRow[]>()) : Promise.resolve([]),
    studentId ? readRows(supabase.from("activity_registrations")
      .select("id,activity_id,student_id,lead_id,status,outcome,operated_by,assessment_started_at,assessment_completed_at,created_at,updated_at")
      .eq("student_id", studentId).order("created_at", { ascending: false }).limit(READ_LIMIT)
      .returns<RegistrationRow[]>()) : Promise.resolve([]),
    leadIds.length ? readRows(supabase.from("activity_registrations")
      .select("id,activity_id,student_id,lead_id,status,outcome,operated_by,assessment_started_at,assessment_completed_at,created_at,updated_at")
      .in("lead_id", leadIds).order("created_at", { ascending: false }).limit(READ_LIMIT)
      .returns<RegistrationRow[]>()) : Promise.resolve([]),
    studentId ? readRows(supabase.from("student_follow_ups")
      .select("id,student_id,author_id,content,kind,next_follow_up_at,status_after,created_at")
      .eq("student_id", studentId).order("created_at", { ascending: false }).limit(READ_LIMIT)
      .returns<FollowUpRow[]>()) : Promise.resolve([]),
    studentId ? readRows(supabase.from("enrollments")
      .select("id,classroom_id,student_id,status,joined_at,left_at,remark,operated_by,created_at")
      .eq("student_id", studentId).order("joined_at", { ascending: false }).limit(READ_LIMIT)
      .returns<EnrollmentRow[]>()) : Promise.resolve([]),
    studentId ? readRows(supabase.from("session_attendance")
      .select("session_id,student_id,status,note,marked_by,marked_at")
      .eq("student_id", studentId).order("marked_at", { ascending: false }).limit(READ_LIMIT)
      .returns<AttendanceRow[]>()) : Promise.resolve([]),
    studentId ? readRows(supabase.from("session_reviews")
      .select("session_id,student_id,entry_score,exit_score,focus,participation,mastery,comment,created_by,updated_at")
      .eq("student_id", studentId).order("updated_at", { ascending: false }).limit(READ_LIMIT)
      .returns<ReviewRow[]>()) : Promise.resolve([]),
    studentId ? readRows(supabase.from("course_enrollments")
      .select("id,note,confirmed_by,confirmed_at,cancelled_by,cancelled_at,courses(title),school_terms(name)")
      .eq("student_id", studentId).order("confirmed_at", { ascending: false }).limit(READ_LIMIT)
      .returns<CommercialEnrollmentRow[]>()) : Promise.resolve([]),
  ]);

  const registrations = [...new Map(
    [...studentRegistrationRows, ...leadRegistrationRows].map((row) => [row.id, row]),
  ).values()];
  if (!student && leads.length === 0 && registrations.length === 0) throw new Error("NOT_FOUND");

  const invitationIds = invitationRows.map((row) => row.id);
  const registrationIds = registrations.map((row) => row.id);
  const activityIds = unique(registrations.map((row) => row.activity_id));
  const sessionIds = unique([
    ...attendanceRows.map((row) => row.session_id),
    ...reviewRows.map((row) => row.session_id),
  ]);

  const [
    invitationEventRows,
    activityRows,
    assessmentRows,
    routeRows,
    publicClassRecordRows,
    questionResultRows,
    postActivityContactRows,
    sessionRows,
  ] = await Promise.all([
    invitationIds.length ? readRows(supabase.from("lead_invitation_events")
      .select("id,invitation_id,from_state,to_state,channel,note,recorded_by,occurred_at")
      .in("invitation_id", invitationIds).order("occurred_at", { ascending: false }).limit(READ_LIMIT)
      .returns<InvitationEventRow[]>()) : Promise.resolve([]),
    activityIds.length ? readRows(supabase.from("activities")
      .select("id,kind,title,scheduled_at,location,remark,created_by,source_invitation_id")
      .in("id", activityIds).limit(READ_LIMIT).returns<ActivityRow[]>()) : Promise.resolve([]),
    registrationIds.length ? readRows(supabase.from("assessment_results")
      .select("id,activity_registration_id,assessment_band,overall_level,score,strengths,focus_areas,parent_concerns,teacher_recommendation,recommended_class,teacher_observation,assessed_by,created_at,updated_at")
      .in("activity_registration_id", registrationIds).order("updated_at", { ascending: false }).limit(READ_LIMIT)
      .returns<AssessmentRow[]>()) : Promise.resolve([]),
    registrationIds.length ? readRows(supabase.from("activity_routes")
      .select("id,activity_registration_id,route,note,routed_by,created_at,updated_at")
      .in("activity_registration_id", registrationIds).order("updated_at", { ascending: false }).limit(READ_LIMIT)
      .returns<RouteRow[]>()) : Promise.resolve([]),
    registrationIds.length ? readRows(supabase.from("public_class_participant_records")
      .select("id,activity_id,segment_id,registration_id,student_presence,guardian_presence,learning_observation,assessment_summary,parent_feedback,recommendation,updated_by,created_at,updated_at")
      .in("registration_id", registrationIds).order("updated_at", { ascending: false }).limit(READ_LIMIT)
      .returns<PublicClassRecordRow[]>()) : Promise.resolve([]),
    registrationIds.length ? readRows(supabase.from("assessment_question_results")
      .select("activity_registration_id,question_id,outcome,note")
      .in("activity_registration_id", registrationIds).limit(READ_LIMIT)
      .returns<QuestionResultRow[]>()) : Promise.resolve([]),
    registrationIds.length ? readRows(supabase.from("activity_followup_contacts")
      .select("id,registration_id,channel,outcome,note,next_contact_at,recorded_by,occurred_at")
      .in("registration_id", registrationIds).order("occurred_at", { ascending: false }).limit(READ_LIMIT)
      .returns<PostActivityContactRow[]>()) : Promise.resolve([]),
    sessionIds.length ? readRows(supabase.from("class_sessions")
      .select("id,classroom_id,title,scheduled_at,started_at,ended_at")
      .in("id", sessionIds).limit(READ_LIMIT).returns<SessionRow[]>()) : Promise.resolve([]),
  ]);

  const segmentIds = unique(publicClassRecordRows.map((row) => row.segment_id));
  const questionIds = unique(questionResultRows.map((row) => row.question_id));
  const classroomIds = unique([
    ...enrollmentRows.map((row) => row.classroom_id),
    ...sessionRows.map((row) => row.classroom_id),
  ]);
  const profileIds = unique(compact([
    student?.assigned_to,
    ...leads.flatMap((row) => [row.owner_id, row.created_by]),
    ...communicationRows.map((row) => row.recorded_by),
    ...nextActionRows.flatMap((row) => [row.created_by, row.completed_by]),
    ...invitationRows.flatMap((row) => [row.assessor_id, row.created_by, row.updated_by]),
    ...invitationEventRows.map((row) => row.recorded_by),
    ...registrations.map((row) => row.operated_by),
    ...activityRows.map((row) => row.created_by),
    ...assessmentRows.map((row) => row.assessed_by),
    ...routeRows.map((row) => row.routed_by),
    ...publicClassRecordRows.map((row) => row.updated_by),
    ...followUpRows.map((row) => row.author_id),
    ...postActivityContactRows.map((row) => row.recorded_by),
    ...commercialEnrollmentRows.flatMap((row) => [row.confirmed_by, row.cancelled_by]),
    ...enrollmentRows.map((row) => row.operated_by),
    ...attendanceRows.map((row) => row.marked_by),
    ...reviewRows.map((row) => row.created_by),
  ]));

  const [segmentRows, questionRows, classroomRows, profileRows] = await Promise.all([
    segmentIds.length ? readRows(supabase.from("public_class_segments")
      .select("id,activity_id,kind,title,scheduled_at,location")
      .in("id", segmentIds).limit(READ_LIMIT).returns<PublicClassSegmentRow[]>()) : Promise.resolve([]),
    questionIds.length ? readRows(supabase.from("assessment_paper_questions")
      .select("id,question_no,knowledge_point")
      .in("id", questionIds).limit(READ_LIMIT).returns<QuestionRow[]>()) : Promise.resolve([]),
    classroomIds.length ? readRows(supabase.from("classrooms")
      .select("id,name").in("id", classroomIds).limit(READ_LIMIT).returns<ClassroomRow[]>()) : Promise.resolve([]),
    profileIds.length ? readRows(supabase.from("profiles")
      .select("id,display_name").in("id", profileIds).limit(READ_LIMIT).returns<ProfileRow[]>()) : Promise.resolve([]),
  ]);

  const leadById = new Map(leads.map((row) => [row.id, row]));
  const interestsBySource = new Map<string, InterestRow[]>();
  for (const row of interestRows) {
    const items = interestsBySource.get(row.source_record_id) ?? [];
    items.push(row);
    interestsBySource.set(row.source_record_id, items);
  }
  const invitationById = new Map(invitationRows.map((row) => [row.id, row]));
  const activityById = new Map(activityRows.map((row) => [row.id, row]));
  const registrationById = new Map(registrations.map((row) => [row.id, row]));
  const segmentById = new Map(segmentRows.map((row) => [row.id, row]));
  const questionById = new Map(questionRows.map((row) => [row.id, row]));
  const sessionById = new Map(sessionRows.map((row) => [row.id, row]));
  const classroomById = new Map(classroomRows.map((row) => [row.id, row]));
  const profileById = new Map(profileRows.map((row) => [row.id, row.display_name]));
  const nameOf = (id: string | null | undefined) => id ? profileById.get(id) ?? null : null;
  const events: Student360Event[] = [];

  for (const lead of leads) {
    const hasSource = sourceRows.some((row) => row.lead_id === lead.id);
    if (!hasSource) addEvent(events, {
      id: `lead:${lead.id}`,
      phase: "source",
      kind: "lead_created",
      occurredAt: lead.created_at,
      title: "",
      status: `lead.${lead.status}`,
      actorName: nameOf(lead.created_by),
      facts: [],
      notes: [],
      important: true,
      source: { kind: "lead", id: lead.id },
    });
    if (lead.identity_confirmed_at) addEvent(events, {
      id: `lead-confirmed:${lead.id}`,
      phase: "enrollment",
      kind: "identity_confirmed",
      occurredAt: lead.identity_confirmed_at,
      title: "",
      status: "identity.student",
      actorName: null,
      facts: [],
      notes: [],
      important: true,
      source: { kind: "lead", id: lead.id },
    });
  }

  for (const row of sourceRows) {
    const interests = interestsBySource.get(row.id) ?? [];
    addEvent(events, {
      id: `source:${row.id}`,
      phase: "source",
      kind: "source_intake",
      occurredAt: row.submitted_at ?? row.created_at,
      title: row.batch_label || row.source_system,
      status: null,
      actorName: null,
      facts: compact([
        fact("source", row.source_system),
        fact("batch", row.batch_label),
        fact("location", row.location_text),
        fact("promoter", row.promoter),
        fact("interest", interests.map((item) => item.label).join(" · ")),
      ]),
      notes: compact([
        note("source_remark", row.remark),
        note("source_interest", row.raw_interest_text),
      ]),
      important: true,
      source: { kind: "lead_source_record", id: row.id },
    });
  }

  for (const row of communicationRows) addEvent(events, {
    id: `contact:${row.id}`,
    phase: "contact",
    kind: "contact",
    occurredAt: row.occurred_at,
    title: "",
    status: `contact.${row.outcome}`,
    actorName: nameOf(row.recorded_by),
    facts: compact([
      fact("channel", row.channel, "code"),
      row.interest_level ? fact("interest", row.interest_level) : null,
      row.wechat_added === null ? null : fact("wechat", String(row.wechat_added), "boolean"),
      row.visit_committed === null ? null : fact("visit", String(row.visit_committed), "boolean"),
    ]),
    notes: compact([note("general", row.note)]),
    important: row.outcome === "connected" || row.outcome === "declined",
    source: { kind: "lead_communication", id: row.id },
  });

  for (const row of postActivityContactRows) {
    const registration = registrationById.get(row.registration_id);
    const activity = registration ? activityById.get(registration.activity_id) : null;
    addEvent(events, {
      id: `post-activity-contact:${row.id}`, phase: "contact", kind: "contact",
      occurredAt: row.occurred_at, title: activity?.title ?? "", status: `contact.${row.outcome}`,
      actorName: nameOf(row.recorded_by),
      facts: compact([fact("channel", row.channel, "code"), fact("due", row.next_contact_at, "datetime")]),
      notes: compact([note("general", row.note)]), important: row.outcome === "connected",
      source: { kind: "activity_followup_contact", id: row.id },
    });
  }

  for (const row of nextActionRows) addEvent(events, {
    id: `next-action:${row.id}`,
    phase: "contact",
    kind: "next_action",
    occurredAt: row.created_at,
    title: "",
    status: `next_action.${row.status}`,
    actorName: nameOf(row.completed_by ?? row.created_by),
    facts: compact([
      fact("next_action_kind", row.kind, "code"),
      fact("due", row.due_at, "datetime"),
    ]),
    notes: [],
    important: row.status === "open",
    source: { kind: "lead_next_action", id: row.id },
  });

  for (const row of invitationRows) addEvent(events, {
    id: `invitation:${row.id}`,
    phase: "invitation",
    kind: "invitation_opened",
    occurredAt: row.created_at,
    title: "",
    status: `invitation.${row.state}`,
    actorName: nameOf(row.created_by),
    facts: compact([
      fact("invitation_kind", row.kind, "code"),
      fact("scheduled", row.scheduled_at ?? row.proposed_time_text, row.scheduled_at ? "datetime" : "text"),
      fact("location", row.location_text),
      fact("assessor", nameOf(row.assessor_id)),
    ]),
    notes: compact([note("general", row.summary)]),
    important: true,
    source: { kind: "lead_invitation_thread", id: row.id },
  });

  for (const row of invitationEventRows) {
    const invitation = invitationById.get(row.invitation_id);
    addEvent(events, {
      id: `invitation-event:${row.id}`,
      phase: "invitation",
      kind: "invitation_update",
      occurredAt: row.occurred_at,
      title: "",
      status: `invitation.${row.to_state}`,
      actorName: nameOf(row.recorded_by),
      facts: compact([
        invitation ? fact("invitation_kind", invitation.kind, "code") : null,
        fact("channel", row.channel, "code"),
        invitation ? fact("scheduled", invitation.scheduled_at ?? invitation.proposed_time_text, invitation.scheduled_at ? "datetime" : "text") : null,
      ]),
      notes: compact([note("general", row.note)]),
      important: row.to_state === "confirmed" || row.to_state === "completed" || row.to_state === "cancelled",
      source: { kind: "lead_invitation_event", id: row.id },
    });
  }

  for (const row of registrations) {
    const activity = activityById.get(row.activity_id);
    if (!activity) continue;
    addEvent(events, {
      id: `activity:${row.id}`,
      phase: "experience",
      kind: "activity",
      occurredAt: activity.scheduled_at,
      title: activity.title,
      status: `registration.${row.status}`,
      actorName: nameOf(row.operated_by ?? activity.created_by),
      facts: compact([
        fact("activity_kind", activity.kind, "code"),
        fact("location", activity.location),
      ]),
      notes: compact([
        note("activity_outcome", row.outcome),
        note("general", activity.remark),
      ]),
      important: row.status === "attended" || row.status === "no_show",
      source: { kind: "activity_registration", id: row.id },
    });
  }

  const questionResultsByRegistration = new Map<string, QuestionResultRow[]>();
  for (const row of questionResultRows) {
    const items = questionResultsByRegistration.get(row.activity_registration_id) ?? [];
    items.push(row);
    questionResultsByRegistration.set(row.activity_registration_id, items);
  }
  for (const row of assessmentRows) {
    const registration = registrationById.get(row.activity_registration_id);
    const activity = registration ? activityById.get(registration.activity_id) : null;
    const questionNotes = (questionResultsByRegistration.get(row.activity_registration_id) ?? [])
      .filter((result) => result.note.trim())
      .map((result) => {
        const question = questionById.get(result.question_id);
        const heading = [question?.question_no ? `Q${question.question_no}` : "", question?.knowledge_point ?? ""]
          .filter(Boolean).join(" · ");
        return note("question_note", heading ? `${heading}\n${result.note}` : result.note);
      });
    addEvent(events, {
      id: `assessment:${row.id}`,
      phase: "assessment",
      kind: "assessment",
      occurredAt: registration?.assessment_completed_at ?? row.updated_at,
      title: activity?.title ?? "",
      status: row.assessment_band ? `assessment.${row.assessment_band}` : row.overall_level ? `assessment.${row.overall_level}` : null,
      actorName: nameOf(row.assessed_by),
      facts: compact([
        fact("score", row.score),
        fact("band", row.assessment_band ?? row.overall_level, "code"),
        fact("classroom", row.recommended_class),
      ]),
      notes: compact([
        note("strengths", row.strengths),
        note("focus_areas", row.focus_areas),
        note("parent_concerns", row.parent_concerns),
        note("teacher_observation", row.teacher_observation),
        note("teacher_recommendation", row.teacher_recommendation),
        ...questionNotes,
      ]),
      important: true,
      source: { kind: "assessment_result", id: row.id },
    });
  }

  for (const row of routeRows) {
    const registration = registrationById.get(row.activity_registration_id);
    const activity = registration ? activityById.get(registration.activity_id) : null;
    addEvent(events, {
      id: `route:${row.id}`,
      phase: "assessment",
      kind: "route",
      occurredAt: row.updated_at,
      title: activity?.title ?? "",
      status: `route.${row.route}`,
      actorName: nameOf(row.routed_by),
      facts: [],
      notes: compact([note("follow_up", row.note)]),
      important: true,
      source: { kind: "activity_route", id: row.id },
    });
  }

  for (const row of publicClassRecordRows) {
    const segment = segmentById.get(row.segment_id);
    const activity = activityById.get(row.activity_id);
    const occurredAt = segment?.scheduled_at ?? row.updated_at;
    addEvent(events, {
      id: `public-class:${row.id}`,
      phase: "experience",
      kind: "public_class_record",
      occurredAt,
      title: [activity?.title, segment?.title].filter(Boolean).join(" · "),
      status: `presence.${row.student_presence === "not_applicable" ? row.guardian_presence : row.student_presence}`,
      actorName: nameOf(row.updated_by),
      facts: compact([
        fact("student_presence", row.student_presence, "code"),
        fact("guardian_presence", row.guardian_presence, "code"),
        fact("location", segment?.location || activity?.location),
      ]),
      notes: compact([
        note("learning_observation", row.learning_observation),
        note("assessment_summary", row.assessment_summary),
        note("parent_feedback", row.parent_feedback),
        note("recommendation", row.recommendation),
      ]),
      important: Boolean(row.learning_observation || row.assessment_summary || row.parent_feedback || row.recommendation),
      source: { kind: "public_class_participant_record", id: row.id },
    });
  }

  const firstEnrollmentAt = enrollmentRows.reduce<string | null>((first, row) => (
    first === null || row.joined_at < first ? row.joined_at : first
  ), null);
  for (const row of followUpRows) addEvent(events, {
    id: `follow-up:${row.id}`,
    phase: followUpPhase(row.kind, row.created_at, firstEnrollmentAt),
    kind: "follow_up",
    occurredAt: row.created_at,
    title: "",
    status: `followup.${row.kind}`,
    actorName: nameOf(row.author_id),
    facts: compact([fact("due", row.next_follow_up_at, "datetime")]),
    notes: compact([note("follow_up", row.content)]),
    important: false,
    source: { kind: "student_follow_up", id: row.id },
  });

  for (const row of commercialEnrollmentRows) {
    const title = [row.courses?.title, row.school_terms?.name].filter(Boolean).join(" · ");
    addEvent(events, {
      id: `course-enrollment:${row.id}`, phase: "enrollment", kind: "course_enrollment",
      occurredAt: row.confirmed_at, title, status: null, actorName: nameOf(row.confirmed_by),
      facts: [], notes: compact([note("enrollment", row.note)]), important: true,
      source: { kind: "course_enrollment", id: row.id },
    });
    if (row.cancelled_at) addEvent(events, {
      id: `course-enrollment-cancelled:${row.id}`, phase: "enrollment", kind: "course_enrollment_cancelled",
      occurredAt: row.cancelled_at, title, status: null, actorName: nameOf(row.cancelled_by),
      facts: [], notes: compact([note("enrollment", row.note)]), important: true,
      source: { kind: "course_enrollment", id: row.id },
    });
  }

  for (const row of enrollmentRows) {
    const classroom = classroomById.get(row.classroom_id);
    addEvent(events, {
      id: `enrollment:${row.id}`,
      phase: "enrollment",
      kind: "enrollment",
      occurredAt: row.joined_at,
      title: classroom?.name ?? "",
      status: "enrollment.active",
      actorName: nameOf(row.operated_by),
      facts: compact([fact("classroom", classroom?.name)]),
      notes: compact([note("enrollment", row.remark)]),
      important: true,
      source: { kind: "enrollment", id: row.id },
    });
    if (row.left_at) addEvent(events, {
      id: `enrollment-ended:${row.id}`,
      phase: "enrollment",
      kind: "enrollment_ended",
      occurredAt: row.left_at,
      title: classroom?.name ?? "",
      status: `enrollment.${row.status}`,
      actorName: nameOf(row.operated_by),
      facts: compact([fact("classroom", classroom?.name)]),
      notes: compact([note("enrollment", row.remark)]),
      important: true,
      source: { kind: "enrollment", id: row.id },
    });
  }

  const attendanceBySession = new Map(attendanceRows.map((row) => [row.session_id, row]));
  const reviewBySession = new Map(reviewRows.map((row) => [row.session_id, row]));
  for (const sessionId of unique([...attendanceBySession.keys(), ...reviewBySession.keys()])) {
    const attendance = attendanceBySession.get(sessionId);
    const review = reviewBySession.get(sessionId);
    const session = sessionById.get(sessionId);
    const classroom = session ? classroomById.get(session.classroom_id) : null;
    addEvent(events, {
      id: `lesson:${sessionId}`,
      phase: "learning",
      kind: "lesson",
      occurredAt: session?.scheduled_at ?? attendance?.marked_at ?? review?.updated_at ?? new Date(0).toISOString(),
      title: [classroom?.name, session?.title].filter(Boolean).join(" · "),
      status: attendance ? `attendance.${attendance.status}` : "lesson.reviewed",
      actorName: nameOf(attendance?.marked_by ?? review?.created_by),
      facts: compact([
        fact("classroom", classroom?.name),
        fact("entry_score", review?.entry_score),
        fact("exit_score", review?.exit_score),
        fact("focus", review?.focus),
        fact("participation", review?.participation),
        fact("mastery", review?.mastery),
      ]),
      notes: compact([
        note("attendance", attendance?.note),
        note("session_review", review?.comment),
      ]),
      important: attendance?.status === "absent" || attendance?.status === "late" || attendance?.status === "leave",
      source: { kind: "class_session", id: sessionId },
    });
  }

  const sortedEvents = sortStudent360Events(events);
  const phases = summarizeStudent360Phases(sortedEvents);
  const openLeadAction = nextActionRows
    .filter((row) => row.status === "open")
    .sort((left, right) => left.due_at.localeCompare(right.due_at))[0];
  const primaryLead = (subject.leadId ? leadById.get(subject.leadId) : null) ?? leads[0] ?? null;
  const assignedId = student?.assigned_to ?? primaryLead?.owner_id ?? null;
  const cappedCollections = [
    linkedLeads,
    sourceRows,
    interestRows,
    communicationRows,
    nextActionRows,
    invitationRows,
    studentRegistrationRows,
    leadRegistrationRows,
    followUpRows,
    enrollmentRows,
    attendanceRows,
    reviewRows,
    invitationEventRows,
    activityRows,
    assessmentRows,
    routeRows,
    publicClassRecordRows,
    questionResultRows,
  ];

  return {
    identity: {
      studentId,
      primaryLeadId: primaryLead?.id ?? subject.leadId,
      linkedLeadIds: leadIds,
      identityState: student ? "student" : studentId ? "journey_only" : primaryLead ? "lead" : "journey_only",
      accessScope: student ? "full" : "journey",
      name: student?.name ?? primaryLead?.provisional_student_name ?? "",
      grade: student?.grade ?? primaryLead?.grade_hint ?? null,
      gradeText: primaryLead?.grade_text ?? "",
      phone: student?.phone || primaryLead?.phone || "",
      wechat: student?.wechat ?? "",
      school: student?.school ?? "",
      parentName: student?.parent_name ?? "",
      parentPhone: student?.parent_phone ?? "",
      assignedName: nameOf(assignedId) ?? "",
      status: student?.status ?? primaryLead?.status ?? "",
      followUpStatus: student?.follow_up_status ?? "",
      profileRemark: student?.remark ?? "",
      nextActionAt: openLeadAction?.due_at ?? student?.next_follow_up_at ?? null,
    },
    currentPhase: latestStudent360Phase(phases),
    phases,
    events: sortedEvents,
    truncated: cappedCollections.some((rows) => rows.length >= READ_LIMIT),
  };
}

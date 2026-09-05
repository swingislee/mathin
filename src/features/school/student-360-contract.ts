export const STUDENT_360_REFRESH_EVENT = "mathin:student-360-refresh";

export const STUDENT_360_PHASES = [
  "source",
  "contact",
  "invitation",
  "experience",
  "assessment",
  "enrollment",
  "learning",
] as const;

export type Student360Phase = (typeof STUDENT_360_PHASES)[number];

export const STUDENT_360_EVENT_KINDS = [
  "lead_created",
  "source_intake",
  "identity_confirmed",
  "contact",
  "next_action",
  "invitation_opened",
  "invitation_update",
  "activity",
  "assessment",
  "route",
  "public_class_record",
  "follow_up",
  "enrollment",
  "course_enrollment",
  "course_enrollment_cancelled",
  "enrollment_ended",
  "lesson",
] as const;

export type Student360EventKind = (typeof STUDENT_360_EVENT_KINDS)[number];

export interface Student360SubjectRef {
  studentId: string | null;
  leadId: string | null;
}

export interface Student360FallbackIdentity {
  name: string;
  grade: number | null;
  gradeText?: string;
  phone?: string;
}

export type Student360FactLabel =
  | "source"
  | "batch"
  | "location"
  | "promoter"
  | "interest"
  | "channel"
  | "next_action_kind"
  | "invitation_kind"
  | "activity_kind"
  | "wechat"
  | "visit"
  | "scheduled"
  | "due"
  | "assessor"
  | "score"
  | "band"
  | "classroom"
  | "student_presence"
  | "guardian_presence"
  | "entry_score"
  | "exit_score"
  | "focus"
  | "participation"
  | "mastery";

export interface Student360Fact {
  label: Student360FactLabel;
  value: string;
  format?: "text" | "datetime" | "boolean" | "code";
}

export type Student360NoteLabel =
  | "general"
  | "source_remark"
  | "source_interest"
  | "activity_outcome"
  | "strengths"
  | "focus_areas"
  | "parent_concerns"
  | "teacher_recommendation"
  | "teacher_observation"
  | "question_note"
  | "learning_observation"
  | "assessment_summary"
  | "parent_feedback"
  | "recommendation"
  | "follow_up"
  | "enrollment"
  | "attendance"
  | "session_review";

export interface Student360Note {
  label: Student360NoteLabel;
  content: string;
}

export interface Student360Event {
  id: string;
  phase: Student360Phase;
  kind: Student360EventKind;
  occurredAt: string;
  title: string;
  status: string | null;
  actorName: string | null;
  facts: Student360Fact[];
  notes: Student360Note[];
  important: boolean;
  source: {
    kind: string;
    id: string;
  };
}

export interface Student360PhaseSummary {
  phase: Student360Phase;
  count: number;
  latestAt: string | null;
}

export interface Student360Identity {
  studentId: string | null;
  primaryLeadId: string | null;
  linkedLeadIds: string[];
  identityState: "student" | "lead" | "journey_only";
  accessScope: "full" | "journey";
  name: string;
  grade: number | null;
  gradeText: string;
  phone: string;
  wechat: string;
  school: string;
  parentName: string;
  parentPhone: string;
  assignedName: string;
  status: string;
  followUpStatus: string;
  profileRemark: string;
  nextActionAt: string | null;
}

export interface Student360Snapshot {
  identity: Student360Identity;
  currentPhase: Student360Phase;
  phases: Student360PhaseSummary[];
  events: Student360Event[];
  truncated: boolean;
}

export function sortStudent360Events(events: readonly Student360Event[]): Student360Event[] {
  return [...events].sort((left, right) => {
    const byTime = right.occurredAt.localeCompare(left.occurredAt);
    return byTime || left.id.localeCompare(right.id);
  });
}

export function summarizeStudent360Phases(
  events: readonly Student360Event[],
): Student360PhaseSummary[] {
  return STUDENT_360_PHASES.map((phase) => {
    const matching = events.filter((event) => event.phase === phase);
    return {
      phase,
      count: matching.length,
      latestAt: matching.reduce<string | null>((latest, event) => (
        latest === null || event.occurredAt > latest ? event.occurredAt : latest
      ), null),
    };
  });
}

export function latestStudent360Phase(
  summaries: readonly Student360PhaseSummary[],
): Student360Phase {
  for (let index = STUDENT_360_PHASES.length - 1; index >= 0; index -= 1) {
    const phase = STUDENT_360_PHASES[index];
    if (summaries.find((summary) => summary.phase === phase)?.count) return phase;
  }
  return "source";
}

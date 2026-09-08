import { STUDENT_LIFECYCLE_STAGES } from "./student-lifecycle-contract";
import type { InvitationDraft } from "./invitation-contract";
import type { InvitationActivityOption, InvitationAssessorOption } from "./invitation-contract";
import type { Phase3EnrollmentOptions } from "./phase3-enrollment-contract";
import { followupPageSize, type FollowupPageSize } from "./followup-table-page";
import type { FollowupServerFields } from "./followup-table-page";

export const STUDENT_STAGE_TABS = [...STUDENT_LIFECYCLE_STAGES, "former_student"] as const;
export type StudentStage = typeof STUDENT_STAGE_TABS[number];
export type StudentEntryMode = "note" | "contact" | "invitation" | "enrollment";
export const STUDENT_RECONTACT_REASONS = ["unreachable", "assessed", "former", "dormant"] as const;
export type StudentRecontactReason = typeof STUDENT_RECONTACT_REASONS[number];
export const STUDENT_STAGE_DETAILS = {
  awaiting_first_contact: ["not_contacted", "unreachable", "unassigned", "invalid_number"],
  awaiting_assessment: ["not_booked", "coordinating", "booked", "no_show", "cancelled", "in_progress"],
  awaiting_enrollment: ["assessed", "awaiting_reply", "considering", "ready_to_enroll", "awaiting_class", "not_enrolling", "payment_pending", "nurturing"],
  awaiting_renewal: ["attending", "awaiting_class", "renewal_considering", "renewal_committed", "renewal_confirmed", "not_renewing"],
  former_student: ["withdrawn", "ended"],
} as const satisfies Record<StudentStage, readonly string[]>;

export type StudentStageAssignment = { key: string; subject: StudentStageRow | null };
export type StudentStageAssignee = { userId: string; displayName: string };

export interface StudentStageRow {
  key: string; studentId: string | null; leadId: string | null;
  name: string; phone: string; grade: number | null; gradeText: string;
  ownerId: string | null; ownerName: string; stage: StudentStage; detail: string;
  teacherId?: string | null; teacherName?: string;
  note: string; lastContactAt: string | null; nextContactAt: string | null;
  score: number | null; assessmentBand: string | null; assessmentAt: string | null;
  assessmentSource?: "assessment" | "class_band" | null;
  assessmentCandidateCount?: number;
  inferredSourceIds?: string[];
  assessmentRecordId?: string | null; learningBand?: string | null; classBandLabel?: string;
  registrationId: string | null; courseTitle: string; termName: string;
  courseId: string | null; termId: string | null; createdAt: string;
  canWrite: boolean; canContact: boolean;
  recontactReason?: StudentRecontactReason;
  sharedPhoneCount?: number;
  invitation: (InvitationDraft & { id: string; leadId: string; updatedAt: string }) | null;
}
export interface StudentStageData {
  rows: StudentStageRow[]; counts: Partial<Record<StudentStage, number>>;
  count: number; page: number; pageSize: FollowupPageSize; totalPages: number;
  fieldView?: FollowupServerFields;
  reasonCounts?: Partial<Record<StudentRecontactReason, number>>;
}
export interface StudentStageFilters {
  stage: StudentStage; scope: "mine" | "all" | "unassigned"; q: string;
  population?: "work" | "records" | "recontact";
  reason?: StudentRecontactReason;
  detail: string; page: number; pageSize: FollowupPageSize;
  fields?: string;
}

export function parseStudentStageFilters(raw: Record<string, string | string[] | undefined>, defaultScope: "mine" | "all" = "mine"): StudentStageFilters {
  const pick = (key: string) => Array.isArray(raw[key]) ? raw[key][0] : raw[key];
  const stageValue = pick("stage");
  const stage = STUDENT_STAGE_TABS.includes(stageValue as StudentStage) ? stageValue as StudentStage : "awaiting_first_contact";
  const q = pick("q")?.trim().slice(0, 80) ?? "";
  const detail = pick("detail") ?? "";
  const scope = pick("scope");
  const page = Number(pick("page"));
  const recontact = pick("population") === "recontact";
  const reason = pick("reason");
  return { stage, q, population: recontact ? "recontact" : q || pick("population") === "records" ? "records" : "work",
    ...(recontact ? { reason: STUDENT_RECONTACT_REASONS.includes(reason as StudentRecontactReason) ? reason as StudentRecontactReason : "unreachable" as const } : {}),
    scope: scope === "mine" || scope === "all" || scope === "unassigned" ? scope : defaultScope,
    detail: !q && (STUDENT_STAGE_DETAILS[stage] as readonly string[]).includes(detail) ? detail : "",
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 1_000_000) : 1,
    pageSize: followupPageSize(pick("pageSize")), ...(pick("fields") ? { fields: pick("fields")!.slice(0, 16_384) } : {}) };
}

export function studentStageHref(filters: StudentStageFilters, change: Partial<StudentStageFilters> = {}) {
  const next = { ...filters, ...change };
  const query = new URLSearchParams({ stage: next.stage, scope: next.scope, pageSize: String(next.pageSize) });
  if (next.population) query.set("population", next.population);
  if (next.population === "recontact" && next.reason) query.set("reason", next.reason);
  if (next.q) query.set("q", next.q);
  if (next.detail) query.set("detail", next.detail);
  if (next.fields) query.set("fields", next.fields);
  if (next.page > 1) query.set("page", String(next.page));
  return `/dashboard/students?${query}`;
}

export function studentRecordTableStage(filters: StudentStageFilters): StudentStage {
  return filters.population === "recontact" ? !filters.reason || filters.reason === "unreachable" ? "awaiting_first_contact" : "awaiting_enrollment" : filters.stage;
}

export function defaultStudentEntryMode(row: StudentStageRow): StudentEntryMode {
  return row.stage === "awaiting_first_contact" && row.canContact ? "contact" : "note";
}

export interface StudentStageEntryInput {
  studentId: string | null; leadId: string | null; mode: StudentEntryMode; note: string;
  nextContactAt: string | null; outcome: "unreachable" | "connected" | "declined" | "invalid_number" | null;
  wechatAdded: boolean | null; interestLevel: "A" | "B" | "C" | null;
  invitation: InvitationDraft | null; expectedInvitationId: string | null; expectedInvitationUpdatedAt: string | null;
  enrollment: {
    courseId: string; termId: string; type: "new" | "renewal" | "reactivate";
    stage: "considering" | "committed" | "payment_pending" | "not_enrolled" | "nurturing";
    confirm: boolean; paymentEvidence: string; expectedOpportunityId: string | null;
  } | null;
}
export interface StudentStageSaved { subject: StudentStageRow; savedAt: string; opportunityId: string | null; enrollmentId: string | null }
export interface StudentStageOptions {
  row: StudentStageRow;
  invitations: { activities: InvitationActivityOption[]; assessors: InvitationAssessorOption[] };
  enrollment: Phase3EnrollmentOptions;
  opportunities: Array<{ id: string; course_id: string; term_id: string; opportunity_type: string; stage: string; updated_at: string }>;
}

/** 同一会话中保存后原行保持位置；身份从 Lead 关联 Student 时替换行键，不添加第二个人。 */
export function replaceSavedStudent(rows: readonly StudentStageRow[], originalKey: string, saved: StudentStageRow): StudentStageRow[] {
  const originalPresent = rows.some(row => row.key === originalKey);
  return rows.flatMap(row => row.key === originalKey ? [saved]
    : originalPresent && row.key === saved.key ? [] : [row]);
}

/** Client-safe invitation constants and DTOs shared by server readers and workbenches. */
export const INVITATION_KINDS = ["assessment_1v1", "activity", "waiting_activity"] as const;
export const INVITATION_STATES = [
  "coordinating_time",
  "awaiting_teacher",
  "awaiting_parent",
  "confirmed",
  "waiting_activity",
  "completed",
  "cancelled",
] as const;
export const INVITATION_CHANNELS = ["phone", "wechat", "in_person", "other"] as const;

export type InvitationKind = (typeof INVITATION_KINDS)[number];
export type InvitationState = (typeof INVITATION_STATES)[number];
export type InvitationChannel = (typeof INVITATION_CHANNELS)[number];
export type InvitationQueue =
  | "coordinating_time"
  | "awaiting_teacher"
  | "awaiting_parent"
  | "confirmed"
  | "waiting_activity"
  | "closed";

export interface InvitationDraft {
  kind: InvitationKind;
  state: InvitationState;
  activityId: string | null;
  assessorId: string | null;
  proposedTimeText: string;
  locationText: string;
}

export interface InvitationSummary extends InvitationDraft {
  id: string;
  activityTitle: string;
  activityScheduledAt: string | null;
  assessorName: string;
  updatedAt: string;
}

export interface InvitationActivityOption {
  id: string;
  kind: string;
  title: string;
  scheduledAt: string;
  location: string;
}

export interface InvitationAssessorOption {
  userId: string;
  displayName: string;
}

export interface InvitationEventRow {
  id: string;
  fromState: InvitationState | null;
  toState: InvitationState;
  channel: InvitationChannel;
  note: string;
  recordedByName: string;
  occurredAt: string;
}

export interface InvitationCoordinationRow extends InvitationSummary {
  leadId: string;
  leadName: string;
  phone: string;
  gradeText: string;
  ownerName: string;
  summary: string;
  events: InvitationEventRow[];
}

export interface InvitationFilters {
  queue: InvitationQueue;
  q?: string;
}

export function defaultInvitationState(kind: InvitationKind): InvitationState {
  if (kind === "assessment_1v1") return "coordinating_time";
  if (kind === "activity") return "awaiting_parent";
  return "waiting_activity";
}

export function invitationStatesForKind(kind: InvitationKind): readonly InvitationState[] {
  if (kind === "assessment_1v1") {
    return ["coordinating_time", "awaiting_teacher", "awaiting_parent", "confirmed"];
  }
  if (kind === "activity") return ["awaiting_parent", "confirmed"];
  return ["waiting_activity"];
}

export function invitationDraftIsComplete(draft: InvitationDraft): boolean {
  if (draft.kind === "assessment_1v1") {
    if (draft.state === "coordinating_time") return true;
    return Boolean(draft.assessorId && draft.proposedTimeText.trim());
  }
  if (draft.kind === "activity") return Boolean(draft.activityId);
  return draft.state === "waiting_activity";
}

export function invitationQueueFrom(value: string | string[] | undefined): InvitationQueue {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "awaiting_teacher"
    || raw === "awaiting_parent"
    || raw === "confirmed"
    || raw === "waiting_activity"
    || raw === "closed"
    ? raw
    : "coordinating_time";
}

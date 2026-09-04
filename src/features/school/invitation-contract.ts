import { calendarDayKey, zonedDateParts, zonedDateTimeToInstant } from "./schedule";

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
export const INVITATION_COORDINATION_STATES = [
  "coordinating_time",
  "awaiting_teacher",
  "awaiting_parent",
] as const;
export const ASSESSMENT_TIME_ZONE = "Asia/Shanghai";
export const ASSESSMENT_SLOT_DEFINITIONS = [
  { key: "09:50", hour: 9, minute: 50 },
  { key: "10:00", hour: 10, minute: 0 },
  { key: "14:00", hour: 14, minute: 0 },
  { key: "16:00", hour: 16, minute: 0 },
  { key: "17:00", hour: 17, minute: 0 },
  { key: "17:30", hour: 17, minute: 30 },
  { key: "19:20", hour: 19, minute: 20 },
  { key: "after_school", hour: null, minute: null },
] as const;
export const MAX_ASSESSMENT_TIME_OPTIONS = 84;

export type InvitationKind = (typeof INVITATION_KINDS)[number];
export type InvitationState = (typeof INVITATION_STATES)[number];
export type InvitationChannel = (typeof INVITATION_CHANNELS)[number];
export type InvitationQueue =
  | "coordination"
  | "confirmed"
  | "waiting_activity"
  | "closed";
export type InvitationCoordinationStage =
  | "all"
  | (typeof INVITATION_COORDINATION_STATES)[number];
export type InvitationWorkStep =
  | "collect_arrangement"
  | "waiting_assessor"
  | "resolve_time_conflict"
  | "choose_shared_time"
  | "confirm_with_parent"
  | "choose_activity"
  | "confirm_activity"
  | "waiting_activity"
  | "confirmed"
  | "closed";

export interface InvitationDraft {
  kind: InvitationKind;
  state: InvitationState;
  activityId: string | null;
  assessorId: string | null;
  parentTimeOptions: string[];
  assessorTimeOptions: string[];
  scheduledAt: string | null;
  locationText: string;
}

export interface InvitationSummary extends InvitationDraft {
  id: string;
  legacyTimeText: string;
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
  stage: InvitationCoordinationStage;
  q?: string;
}

export interface InvitationQueueCounts {
  queues: Record<InvitationQueue, number>;
  stages: Record<InvitationCoordinationStage, number>;
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

export function assessmentAvailabilityIntersection(
  parentTimeOptions: readonly string[],
  assessorTimeOptions: readonly string[],
): string[] {
  const assessorOptions = new Set(assessorTimeOptions);
  return [...new Set(parentTimeOptions)]
    .filter((slot) => assessorOptions.has(slot))
    .sort((left, right) => left.localeCompare(right));
}

export function assessmentTimeOptionToken(day: Date, slotKey: string): string {
  return `${calendarDayKey(day, ASSESSMENT_TIME_ZONE)}@${slotKey}`;
}

export function parseAssessmentTimeOption(value: string): { dayKey: string; slotKey: string } | null {
  const match = /^(\d{4}-\d{2}-\d{2})@(.+)$/.exec(value);
  if (!match || !ASSESSMENT_SLOT_DEFINITIONS.some((slot) => slot.key === match[2])) return null;
  return { dayKey: match[1], slotKey: match[2] };
}

export function assessmentTimeOptionForInstant(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = zonedDateParts(date, ASSESSMENT_TIME_ZONE);
  const slotKey = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  if (!ASSESSMENT_SLOT_DEFINITIONS.some((slot) => slot.key === slotKey)) return null;
  return assessmentTimeOptionToken(date, slotKey);
}

export function assessmentTimeOptionToInstant(value: string): string | null {
  const parsed = parseAssessmentTimeOption(value);
  const definition = ASSESSMENT_SLOT_DEFINITIONS.find((slot) => slot.key === parsed?.slotKey);
  if (!parsed || !definition || definition.hour === null || definition.minute === null) return null;
  const [year, month, day] = parsed.dayKey.split("-").map(Number);
  const instant = zonedDateTimeToInstant({
    year,
    month: month - 1,
    day,
    hour: definition.hour,
    minute: definition.minute,
  }, ASSESSMENT_TIME_ZONE);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

export function isAssessmentTimeOption(value: string): boolean {
  return parseAssessmentTimeOption(value) !== null;
}

export function normalizeAssessmentTimeOptions(values: readonly string[]): string[] {
  return [...new Set(values)]
    .filter(isAssessmentTimeOption)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_ASSESSMENT_TIME_OPTIONS);
}

export function invitationDraftIsComplete(draft: InvitationDraft): boolean {
  if (draft.kind === "assessment_1v1") {
    if (draft.state === "coordinating_time") return true;
    if (!draft.assessorId || draft.parentTimeOptions.length === 0) return false;
    const intersection = assessmentAvailabilityIntersection(
      draft.parentTimeOptions,
      draft.assessorTimeOptions,
    );
    if (draft.state === "awaiting_teacher") return true;
    if (draft.state === "awaiting_parent") return intersection.length > 0;
    const scheduledOption = draft.scheduledAt ? assessmentTimeOptionForInstant(draft.scheduledAt) : null;
    return Boolean(scheduledOption && intersection.includes(scheduledOption));
  }
  if (draft.kind === "activity") return Boolean(draft.activityId);
  return draft.state === "waiting_activity";
}

export function invitationStateFromFacts(draft: InvitationDraft): InvitationState {
  if (draft.state === "completed" || draft.state === "cancelled" || draft.state === "confirmed") {
    return draft.state;
  }
  if (draft.kind === "waiting_activity") return "waiting_activity";
  if (draft.kind === "activity") return "awaiting_parent";
  if (!draft.assessorId || draft.parentTimeOptions.length === 0) return "coordinating_time";
  if (draft.assessorTimeOptions.length === 0) return "awaiting_teacher";
  const intersection = assessmentAvailabilityIntersection(
    draft.parentTimeOptions,
    draft.assessorTimeOptions,
  );
  const scheduledOption = draft.scheduledAt ? assessmentTimeOptionForInstant(draft.scheduledAt) : null;
  return scheduledOption && intersection.includes(scheduledOption)
    ? "awaiting_parent"
    : "coordinating_time";
}

/**
 * 学辅看到的是当前应执行的工作，而不是可以任意切换的状态机。
 * 该步骤完全由已经登记的业务事实推导。
 */
export function invitationWorkStep(draft: InvitationDraft): InvitationWorkStep {
  if (draft.state === "completed" || draft.state === "cancelled") return "closed";
  if (draft.state === "confirmed") return "confirmed";
  if (draft.kind === "waiting_activity") return "waiting_activity";
  if (draft.kind === "activity") return draft.activityId ? "confirm_activity" : "choose_activity";
  if (!draft.assessorId || draft.parentTimeOptions.length === 0) return "collect_arrangement";
  if (draft.assessorTimeOptions.length === 0) return "waiting_assessor";
  const intersection = assessmentAvailabilityIntersection(
    draft.parentTimeOptions,
    draft.assessorTimeOptions,
  );
  if (intersection.length === 0) return "resolve_time_conflict";
  const scheduledOption = draft.scheduledAt ? assessmentTimeOptionForInstant(draft.scheduledAt) : null;
  return scheduledOption && intersection.includes(scheduledOption)
    ? "confirm_with_parent"
    : "choose_shared_time";
}

export function invitationQueueFrom(value: string | string[] | undefined): InvitationQueue {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "confirmed"
    || raw === "waiting_activity"
    || raw === "closed"
    ? raw
    : "coordination";
}

export function invitationCoordinationStageFrom(
  queueValue: string | string[] | undefined,
  stageValue: string | string[] | undefined,
): InvitationCoordinationStage {
  const rawQueue = Array.isArray(queueValue) ? queueValue[0] : queueValue;
  const rawStage = Array.isArray(stageValue) ? stageValue[0] : stageValue;
  const candidate = INVITATION_COORDINATION_STATES.includes(
    rawQueue as (typeof INVITATION_COORDINATION_STATES)[number],
  ) ? rawQueue : rawStage;
  return candidate === "coordinating_time"
    || candidate === "awaiting_teacher"
    || candidate === "awaiting_parent"
    ? candidate
    : "all";
}

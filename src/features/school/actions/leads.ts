"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import {
  INVITATION_KINDS,
  INVITATION_STATES,
  invitationCanHaveNextContactReminder,
  invitationDraftIsComplete,
  invitationStatesForKind,
  isAssessmentTimeOption,
  MAX_ASSESSMENT_TIME_OPTIONS,
  type InvitationDraft,
} from "../invitation-contract";
import type {
  LeadIdentityConfirmation,
  LeadIdentityInput,
  LeadIdentityOptions,
} from "../lead-identity-contract";
import { authorizedClient, nullableRpcArg } from "./guards";
import { COMMON_CODES, datetime, intInRange, parse, requiredText, text, uuid } from "./schemas";

type UntypedRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

function rpc(supabase: { rpc: unknown }): UntypedRpc {
  return (supabase.rpc as UntypedRpc).bind(supabase);
}

const LEAD_CONTACT_OUTCOMES = ["unreachable", "connected", "declined", "invalid_number"] as const;
const LEAD_INTEREST_LEVELS = ["A", "B", "C"] as const;
const timeOptions = z.array(z.string().refine(isAssessmentTimeOption))
  .max(MAX_ASSESSMENT_TIME_OPTIONS)
  .refine((values) => new Set(values).size === values.length);

const assignLeadsSchema = z.object({
  leadIds: z.array(uuid).min(1).max(100).refine((ids) => new Set(ids).size === ids.length),
  staffUserId: uuid,
});

const invitationDraftSchema = z.object({
  kind: z.enum(INVITATION_KINDS),
  state: z.enum(INVITATION_STATES),
  activityId: uuid.nullable(),
  assessorId: uuid.nullable(),
  parentTimeOptions: timeOptions,
  assessorTimeOptions: timeOptions,
  scheduledAt: z.string().datetime({ offset: true }).nullable(),
  locationText: text(200),
  nextContactAt: datetime.nullable().default(null),
});

const leadContactSchema = z.object({
  leadId: uuid,
  outcome: z.enum(LEAD_CONTACT_OUTCOMES),
  note: text(2000),
  wechatAdded: z.boolean().nullable(),
  interestLevel: z.enum(LEAD_INTEREST_LEVELS).nullable(),
  invitation: invitationDraftSchema.nullable(),
  nextContactAt: datetime.nullable().default(null),
}).superRefine((value, context) => {
  if (["unreachable", "invalid_number"].includes(value.outcome)
      && value.wechatAdded === true) {
    context.addIssue({ code: "custom", message: "INVALID_CONTACT_FACT" });
  }
  if (value.invitation) {
    if (value.outcome !== "connected"
        || !invitationStatesForKind(value.invitation.kind).includes(value.invitation.state)
        || !invitationDraftIsComplete(value.invitation)) {
      context.addIssue({ code: "custom", message: "INVALID_INVITATION" });
    }
    if (value.invitation.kind !== "assessment_1v1" && (
      value.invitation.parentTimeOptions.length > 0
      || value.invitation.assessorTimeOptions.length > 0
      || value.invitation.scheduledAt
    )) {
      context.addIssue({ code: "custom", message: "INVALID_INVITATION" });
    }
    if ((value.invitation.nextContactAt ?? null) !== value.nextContactAt) {
      context.addIssue({ code: "custom", message: "INVALID_INVITATION" });
    }
  }
  const reminderAllowed = value.outcome === "unreachable"
    || value.outcome === "declined"
    || Boolean(value.invitation && invitationCanHaveNextContactReminder(value.invitation));
  if (value.nextContactAt && !reminderAllowed) {
    context.addIssue({ code: "custom", message: "REMINDER_NOT_ALLOWED" });
  }
  if (value.nextContactAt && new Date(value.nextContactAt).getTime() <= Date.now()) {
    context.addIssue({ code: "custom", message: "REMINDER_NOT_FUTURE" });
  }
});

export type LeadContactInput = {
  outcome: (typeof LEAD_CONTACT_OUTCOMES)[number];
  note: string;
  wechatAdded: boolean | null;
  interestLevel: (typeof LEAD_INTEREST_LEVELS)[number] | null;
  invitation: InvitationDraft | null;
  nextContactAt: string | null;
};

const leadReminderSchema = z.object({
  leadId: uuid,
  nextContactAt: datetime.nullable(),
}).superRefine((value, context) => {
  if (value.nextContactAt && new Date(value.nextContactAt).getTime() <= Date.now()) {
    context.addIssue({ code: "custom", message: "REMINDER_NOT_FUTURE" });
  }
});

const existingIdentitySchema = z.object({
  mode: z.literal("existing"),
  id: uuid,
}).strict();

const leadIdentitySchema = z.object({
  student: z.discriminatedUnion("mode", [
    existingIdentitySchema,
    z.object({
      mode: z.literal("create"),
      name: requiredText(100),
      grade: intInRange(1, 12).nullable(),
    }).strict(),
  ]),
  family: z.discriminatedUnion("mode", [
    existingIdentitySchema,
    z.object({
      mode: z.literal("create"),
      displayName: requiredText(120),
    }).strict(),
  ]),
  contact: z.discriminatedUnion("mode", [
    existingIdentitySchema,
    z.object({
      mode: z.literal("create"),
      displayName: requiredText(100),
      phone: requiredText(40),
      wechat: text(100),
    }).strict(),
  ]),
  relationship: z.object({
    relation: requiredText(40),
    isPrimaryFamily: z.boolean(),
    isPrimaryContact: z.boolean(),
    isDecisionMaker: z.boolean(),
    preferredChannel: z.enum(["phone", "wechat", "other"]),
  }).strict(),
  allowPossibleDuplicate: z.boolean(),
  allowAdditionalRelationship: z.boolean(),
}).strict();

const confirmLeadIdentitySchema = z.object({
  leadId: uuid,
  idempotencyKey: z.string().trim().min(16).max(200),
  identity: leadIdentitySchema,
}).strict();

const LEAD_IDENTITY_CODES = [
  "FORBIDDEN_SCOPE",
  "LEAD_UNASSIGNED",
  "LEAD_CLOSED",
  "STUDENT_NOT_FOUND",
  "FAMILY_NOT_FOUND",
  "CONTACT_NOT_FOUND",
  "POSSIBLE_STUDENT_DUPLICATE",
  "POSSIBLE_FAMILY_DUPLICATE",
  "POSSIBLE_CONTACT_DUPLICATE",
  "RELATIONSHIP_CONFLICT",
  "PRIMARY_RELATION_REQUIRED",
  "COURSE_OPPORTUNITY_IDENTITY_CONFLICT",
  "LEAD_IDENTITY_HISTORY_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "INVALID_IDENTITY",
  "NOT_FOUND",
  ...COMMON_CODES,
] as const;

export async function getLeadIdentityOptionsAction(
  leadId: string,
): Promise<ActionResult<LeadIdentityOptions>> {
  try {
    const id = parse(uuid, leadId);
    const { supabase } = await authorizedClient("followup.view");
    const { data, error } = await rpc(supabase)("get_lead_identity_options", {
      p_lead_id: id,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: data as LeadIdentityOptions };
  } catch (error) {
    return actionError<LeadIdentityOptions>(error, LEAD_IDENTITY_CODES);
  }
}

/**
 * The single application mutation for Lead identity promotion. Later phases
 * may route an operator here, but enrollment must never invoke or hide it.
 */
export async function confirmLeadIdentityAction(
  leadId: string,
  idempotencyKey: string,
  input: LeadIdentityInput,
): Promise<ActionResult<LeadIdentityConfirmation>> {
  try {
    const value = parse(confirmLeadIdentitySchema, {
      leadId,
      idempotencyKey,
      identity: input,
    });
    const { supabase } = await authorizedClient("followup.write");
    const { data, error } = await rpc(supabase)("confirm_lead_identity", {
      p_lead_id: value.leadId,
      p_idempotency_key: value.idempotencyKey,
      p_identity: value.identity,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: data as LeadIdentityConfirmation };
  } catch (error) {
    return actionError<LeadIdentityConfirmation>(error, LEAD_IDENTITY_CODES);
  }
}

export async function assignLeadsAction(leadIds: string[], staffUserId: string): Promise<ActionResult<{ count: number }>> {
  try {
    const value = parse(assignLeadsSchema, { leadIds, staffUserId });
    const { supabase } = await authorizedClient("student.assign");
    const { data, error } = await supabase.rpc("assign_leads", {
      p_lead_ids: value.leadIds,
      p_staff_user_id: value.staffUserId,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: { count: Number(data ?? value.leadIds.length) } };
  } catch (error) {
    return actionError(error, ["TARGET_CANNOT_FOLLOW_UP", "LEAD_SCOPE_MISMATCH", ...COMMON_CODES]);
  }
}

export async function recordLeadContactAction(
  leadId: string,
  input: LeadContactInput,
): Promise<ActionResult> {
  try {
    const value = parse(leadContactSchema, { leadId, ...input });
    const { supabase } = await authorizedClient("followup.write");
    const invitation = value.invitation;
    const { error } = await supabase.rpc("record_lead_contact_v4", {
      p_lead_id: value.leadId,
      p_outcome: value.outcome,
      p_note: value.note,
      p_wechat_added: nullableRpcArg(value.wechatAdded),
      p_interest_level: nullableRpcArg(value.interestLevel),
      p_invitation_kind: nullableRpcArg(invitation?.kind ?? null),
      p_invitation_state: nullableRpcArg(invitation?.state ?? null),
      p_activity_id: nullableRpcArg(invitation?.activityId ?? null),
      p_assessor_id: nullableRpcArg(invitation?.assessorId ?? null),
      p_parent_time_options: invitation?.parentTimeOptions ?? [],
      p_assessor_time_options: invitation?.assessorTimeOptions ?? [],
      p_scheduled_at: nullableRpcArg(invitation?.scheduledAt ?? null),
      p_location_text: invitation?.locationText ?? "",
      p_next_contact_at: nullableRpcArg(value.nextContactAt),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, [
      "LEAD_UNASSIGNED",
      "LEAD_CLOSED",
      "FORBIDDEN_SCOPE",
      "INVALID_INVITATION",
      "ACTIVITY_NOT_FOUND",
      "ASSESSOR_UNAVAILABLE",
      "NOT_FOUND",
      "REMINDER_NOT_FUTURE",
      "REMINDER_NOT_ALLOWED",
      ...COMMON_CODES,
    ]);
  }
}

export async function setLeadContactReminderAction(
  leadId: string,
  nextContactAt: string | null,
): Promise<ActionResult> {
  try {
    const value = parse(leadReminderSchema, { leadId, nextContactAt });
    const { supabase } = await authorizedClient("followup.write");
    const { error } = await supabase.rpc("set_lead_contact_reminder", {
      p_lead_id: value.leadId,
      p_remind_at: nullableRpcArg(value.nextContactAt),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, [
      "REMINDER_NOT_FUTURE",
      "REMINDER_NOT_ALLOWED",
      "INITIAL_CONTACT_PENDING",
      "LEAD_UNASSIGNED",
      "LEAD_CLOSED",
      "FORBIDDEN_SCOPE",
      "NOT_FOUND",
      ...COMMON_CODES,
    ]);
  }
}

"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import {
  INVITATION_CHANNELS,
  INVITATION_KINDS,
  INVITATION_STATES,
  invitationDraftIsComplete,
  invitationStatesForKind,
  isAssessmentTimeOption,
  MAX_ASSESSMENT_TIME_OPTIONS,
  type InvitationChannel,
  type InvitationDraft,
} from "../invitation-contract";
import { authorizedClient, nullableRpcArg } from "./guards";
import { COMMON_CODES, datetime, parse, text, uuid } from "./schemas";

const timeOptions = z.array(z.string().refine(isAssessmentTimeOption))
  .max(MAX_ASSESSMENT_TIME_OPTIONS)
  .refine((values) => new Set(values).size === values.length);

const updateInvitationSchema = z.object({
  invitationId: uuid,
  kind: z.enum(INVITATION_KINDS),
  state: z.enum(INVITATION_STATES),
  activityId: uuid.nullable(),
  assessorId: uuid.nullable(),
  parentTimeOptions: timeOptions,
  assessorTimeOptions: timeOptions,
  scheduledAt: z.string().datetime({ offset: true }).nullable(),
  locationText: text(200),
  nextContactAt: datetime.nullable().default(null),
  channel: z.enum(INVITATION_CHANNELS),
  note: text(2000),
}).superRefine((value, context) => {
  const activeState = !["completed", "cancelled"].includes(value.state);
  if ((activeState && !invitationStatesForKind(value.kind).includes(value.state))
      || (activeState && !invitationDraftIsComplete(value))) {
    context.addIssue({ code: "custom", message: "INVALID_INVITATION" });
  }
  if (value.kind === "activity" && !value.activityId) {
    context.addIssue({ code: "custom", message: "ACTIVITY_REQUIRED" });
  }
  if (value.kind !== "assessment_1v1" && (
    value.parentTimeOptions.length > 0
    || value.assessorTimeOptions.length > 0
    || value.scheduledAt
  )) {
    context.addIssue({ code: "custom", message: "INVALID_INVITATION" });
  }
  if (value.nextContactAt && ![
    "coordinating_time",
    "awaiting_teacher",
    "awaiting_parent",
    "waiting_activity",
  ].includes(value.state)) {
    context.addIssue({ code: "custom", message: "REMINDER_NOT_ALLOWED" });
  }
  if (value.nextContactAt && new Date(value.nextContactAt).getTime() <= Date.now()) {
    context.addIssue({ code: "custom", message: "REMINDER_NOT_FUTURE" });
  }
});

export type UpdateInvitationInput = InvitationDraft & {
  channel: InvitationChannel;
  note: string;
};

export async function updateLeadInvitationAction(
  invitationId: string,
  input: UpdateInvitationInput,
): Promise<ActionResult> {
  try {
    const value = parse(updateInvitationSchema, { invitationId, ...input });
    const { supabase } = await authorizedClient("followup.write");
    const { error } = await supabase.rpc("update_lead_invitation_v3", {
      p_invitation_id: value.invitationId,
      p_kind: value.kind,
      p_state: value.state,
      p_activity_id: nullableRpcArg(value.activityId),
      p_assessor_id: nullableRpcArg(value.assessorId),
      p_parent_time_options: value.parentTimeOptions,
      p_assessor_time_options: value.assessorTimeOptions,
      p_scheduled_at: nullableRpcArg(value.scheduledAt),
      p_location_text: value.locationText,
      p_channel: value.channel,
      p_note: value.note,
      p_next_contact_at: nullableRpcArg(value.nextContactAt),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, [
      "INVALID_INVITATION",
      "ACTIVITY_NOT_FOUND",
      "ASSESSOR_UNAVAILABLE",
      "INVITATION_CLOSED",
      "LEAD_UNASSIGNED",
      "LEAD_CLOSED",
      "FORBIDDEN_SCOPE",
      "REMINDER_NOT_FUTURE",
      "REMINDER_NOT_ALLOWED",
      "NOT_FOUND",
      ...COMMON_CODES,
    ]);
  }
}

const assessorAvailabilitySchema = z.object({
  invitationId: uuid,
  assessorTimeOptions: timeOptions,
});

export async function updateAssessorAvailabilityAction(
  invitationId: string,
  assessorTimeOptions: string[],
): Promise<ActionResult> {
  try {
    const value = parse(assessorAvailabilitySchema, { invitationId, assessorTimeOptions });
    const { supabase } = await authorizedClient("review.write");
    const { error } = await supabase.rpc("set_invitation_assessor_availability", {
      p_invitation_id: value.invitationId,
      p_assessor_time_options: value.assessorTimeOptions,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, [
      "INVITATION_CLOSED",
      "ASSESSOR_SCOPE",
      "INVALID_INVITATION",
      "NOT_FOUND",
      ...COMMON_CODES,
    ]);
  }
}

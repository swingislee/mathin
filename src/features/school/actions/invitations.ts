"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import {
  INVITATION_CHANNELS,
  INVITATION_KINDS,
  INVITATION_STATES,
  invitationDraftIsComplete,
  invitationStatesForKind,
  type InvitationChannel,
  type InvitationDraft,
} from "../invitation-contract";
import { authorizedClient, nullableRpcArg } from "./guards";
import { COMMON_CODES, parse, text, uuid } from "./schemas";

const updateInvitationSchema = z.object({
  invitationId: uuid,
  kind: z.enum(INVITATION_KINDS),
  state: z.enum(INVITATION_STATES),
  activityId: uuid.nullable(),
  assessorId: uuid.nullable(),
  proposedTimeText: text(200),
  locationText: text(200),
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
    const { error } = await supabase.rpc("update_lead_invitation", {
      p_invitation_id: value.invitationId,
      p_kind: value.kind,
      p_state: value.state,
      p_activity_id: nullableRpcArg(value.activityId),
      p_assessor_id: nullableRpcArg(value.assessorId),
      p_proposed_time_text: value.proposedTimeText,
      p_location_text: value.locationText,
      p_channel: value.channel,
      p_note: value.note,
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
      "NOT_FOUND",
      ...COMMON_CODES,
    ]);
  }
}

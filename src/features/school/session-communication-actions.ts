"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient, nullableRpcArg } from "./actions/guards";
import { COMMON_CODES, dateOnly, parse, requiredText, text, uuid } from "./actions/schemas";
import { COMMUNICATION_CHANNELS, COMMUNICATION_OUTCOMES, sessionCommunicationsSchema, type SessionCommunications } from "./session-communication-contract";

const communicationSchema = z.object({
  id: uuid, sessionId: uuid, studentId: uuid.nullable(), occurredOn: dateOnly.pipe(z.iso.date()),
  channel: z.enum(COMMUNICATION_CHANNELS), outcome: z.enum(COMMUNICATION_OUTCOMES),
  content: requiredText(2000), nextAction: text(1000), nextFollowUpOn: dateOnly.pipe(z.iso.date()).nullable(),
}).refine(value => value.outcome !== "follow_up" || Boolean(value.nextAction && value.nextFollowUpOn));
const completeSchema = z.object({ sessionId: uuid });

function refreshCommunication(sessionId: string) {
  revalidatePath(`/[locale]/dashboard/sessions/${sessionId}`, "page");
  revalidatePath("/[locale]/dashboard/classes", "layout");
  revalidatePath("/[locale]/dashboard/students", "layout");
}

export async function recordSessionCommunication(input: z.infer<typeof communicationSchema>): Promise<ActionResult<SessionCommunications>> {
  try {
    const value = parse(communicationSchema, input);
    const { supabase } = await authorizedClient("followup.write");
    const { data, error } = await supabase.rpc("record_session_communication", {
      p_id: value.id, p_session_id: value.sessionId, p_student_id: nullableRpcArg(value.studentId),
      p_occurred_on: value.occurredOn, p_channel: value.channel, p_outcome: value.outcome,
      p_content: value.content, p_next_action: value.nextAction, p_next_follow_up_on: nullableRpcArg(value.nextFollowUpOn),
    });
    if (error) throw new Error(error.message);
    refreshCommunication(value.sessionId);
    return { ok: true as const, data: sessionCommunicationsSchema.parse(data) };
  } catch (error) { return actionError(error, [...COMMON_CODES, "SUBMISSION_CONFLICT"]); }
}

export async function finishSessionCommunications(sessionId: string): Promise<ActionResult<SessionCommunications>> {
  try {
    const value = parse(completeSchema, { sessionId });
    const { supabase } = await authorizedClient("followup.write");
    const { data, error } = await supabase.rpc("finish_session_communications", { p_session_id: value.sessionId });
    if (error) throw new Error(error.message);
    refreshCommunication(value.sessionId);
    return { ok: true as const, data: sessionCommunicationsSchema.parse(data) };
  } catch (error) { return actionError(error, [...COMMON_CODES, "COMMUNICATIONS_PENDING"]); }
}

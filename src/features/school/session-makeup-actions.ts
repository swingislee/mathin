"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "./actions/guards";
import { COMMON_CODES, parse, uuid } from "./actions/schemas";
import { makeupRecordInputSchema, sessionMakeupsSchema, type SessionMakeups } from "./session-makeup-contract";

const saveSchema = z.object({ id: uuid, sessionId: uuid, revision: z.number().int().min(0), record: makeupRecordInputSchema });
export async function readSessionMakeups(sessionId: string): Promise<ActionResult<SessionMakeups>> {
  try {
    const id = parse(uuid, sessionId);
    const { supabase } = await authorizedClient("attendance.mark");
    const { data, error } = await supabase.rpc("read_session_makeups", { p_session_id: id });
    if (error) throw new Error(error.message);
    return { ok: true, data: sessionMakeupsSchema.parse(data) };
  } catch (error) { return actionError(error, COMMON_CODES); }
}
export async function saveSessionMakeup(input: z.infer<typeof saveSchema>): Promise<ActionResult<SessionMakeups>> {
  try {
    const value = parse(saveSchema, input);
    const { supabase } = await authorizedClient("attendance.mark");
    const { data, error } = await supabase.rpc("save_session_makeup", {
      p_id: value.id, p_session_id: value.sessionId, p_expected_revision: value.revision, p_record: value.record,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: sessionMakeupsSchema.parse(data) };
  } catch (error) { return actionError(error, [...COMMON_CODES, "CONFLICT", "STUDENT_NOT_IN_SESSION"]); }
}

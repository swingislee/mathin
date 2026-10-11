"use server";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "./actions/guards";

const invite = z.object({ id: z.string().uuid(), code: z.string().regex(/^[a-f0-9]{32}$/), expiresAt: z.string() });
export async function issueMiniappGuardianInvite(studentId: string): Promise<ActionResult<z.infer<typeof invite>>> {
  try {
    const { supabase } = await authorizedClient("student.edit");
    const { data, error } = await supabase.rpc("issue_miniapp_guardian_invite", { p_student_id: z.string().uuid().parse(studentId) });
    if (error) throw new Error(error.message);
    return { ok: true, data: invite.parse(data) };
  } catch (error) { return actionError(error, ["FORBIDDEN", "UNAUTHENTICATED"]); }
}
export async function revokeMiniappGuardianInvite(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorizedClient("student.edit");
    const { error } = await supabase.rpc("revoke_miniapp_guardian_invite", { p_id: z.string().uuid().parse(id) });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) { return actionError(error, ["FORBIDDEN", "UNAUTHENTICATED", "CONFLICT"]); }
}

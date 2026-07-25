"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "./guards";
import { COMMON_CODES, parse } from "./schemas";

const inviteSettingsSchema = z.object({
  code: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9_-]{6,32}$/)),
  isActive: z.boolean(),
});

export async function updateRegistrationInviteAction(code: string, isActive: boolean): Promise<ActionResult> {
  try {
    const value = parse(inviteSettingsSchema, { code, isActive });
    const { supabase } = await authorizedClient("registration.invite.manage");
    const { error } = await supabase.rpc("set_registration_invite", {
      p_code: value.code,
      p_is_active: value.isActive,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, [...COMMON_CODES, "INVALID_INVITE_CODE"]);
  }
}

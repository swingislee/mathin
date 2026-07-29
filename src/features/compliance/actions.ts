"use server";

import { z } from "zod";
import { COMMON_CODES, parse, text } from "@/features/school/actions/schemas";
import { actionError, type ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";

const requestSchema = z.object({
  kind: z.enum(["delete", "export"]),
  reason: text(1000),
});

export async function requestAccountAction(formData: FormData): Promise<ActionResult> {
  try {
    const value = parse(requestSchema, { kind: formData.get("kind"), reason: formData.get("reason") });
    const supabase = await createClient();
    const { error } = await supabase.rpc("request_account_action", {
      p_kind: value.kind,
      p_reason: value.reason,
      p_data_scope: "account",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["REQUEST_ALREADY_OPEN", ...COMMON_CODES], "FAILED");
  }
}

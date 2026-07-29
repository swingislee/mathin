"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";

const replayJobSchema = z.object({
  jobId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});

export async function replayDeadJobAction(input: unknown): Promise<ActionResult<{ jobId: string }>> {
  const parsed = replayJobSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) throw new Error("UNAUTHENTICATED");
    const { data, error } = await supabase.rpc("replay_dead_job", {
      p_job_id: parsed.data.jobId,
      p_reason: parsed.data.reason,
    });
    if (error || !data) throw new Error(error?.message || "REPLAY_FAILED");
    revalidatePath("/[locale]/dashboard/system-health", "page");
    return { ok: true, data: { jobId: data } };
  } catch (error) {
    return actionError(error, ["UNAUTHENTICATED", "FORBIDDEN", "JOB_NOT_REPLAYABLE", "VALIDATION"], "REPLAY_FAILED");
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizedClient } from "@/features/school/actions/guards";

const reviewSchema = z.object({ adaptationId: z.uuid(), decision: z.enum(["approve", "reject"]) });

/** P6-6 背景确认闸门；未确认的派生背景会被 DB trigger 拒绝进入 release。 */
export async function reviewAdaptBackground(adaptationId: string, decision: "approve" | "reject"): Promise<void> {
  const input = reviewSchema.parse({ adaptationId, decision });
  const { supabase } = await authorizedClient("courseware.asset.manage");
  const { error } = await supabase.rpc("review_cw_adapt_background", {
    p_adaptation_id: input.adaptationId,
    p_approve: input.decision === "approve",
    p_note: "",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/courseware/adapt");
}

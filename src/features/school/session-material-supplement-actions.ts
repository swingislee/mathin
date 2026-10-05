"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "./actions/guards";
import { materialSupplementSchema, materialSupplementResultSchema, type MaterialSupplementInput, type MaterialSupplementResult, type MaterialSupplementRpc } from "./session-material-supplement-contract";

export async function supplementSessionMaterialAction(input: MaterialSupplementInput): Promise<ActionResult<MaterialSupplementResult>> {
  try {
    const parsed = materialSupplementSchema.safeParse(input);
    if (!parsed.success) throw new Error("VALIDATION");
    const value = parsed.data;
    const { supabase } = await authorizedClient("class.manage");
    const client = supabase as unknown as { rpc: MaterialSupplementRpc };
    const { data, error } = await client.rpc("supplement_session_preparation_artifact", {
      p_session_id: value.sessionId, p_kind: value.kind, p_files: value.files, p_notes: value.notes, p_video_url: value.videoUrl,
    });
    if (error) throw new Error(error.message);
    const result = materialSupplementResultSchema.parse(data);
    revalidatePath("/[locale]/dashboard/classes", "page");
    revalidatePath("/[locale]/dashboard/sessions/[sessionId]", "page");
    return { ok: true, data: result };
  } catch (error) {
    return actionError(error, ["UNAUTHENTICATED", "FORBIDDEN", "SESSION_NOT_FOUND", "VALIDATION", "FILES_LIMIT", "NOTES_LIMIT", "MATERIAL_CONFLICT", "REVIEWER_NOT_AVAILABLE"]);
  }
}

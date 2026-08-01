"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { COMMON_CODES, parse, uuid } from "./schemas";

const solutionExportSchema = z.object({
  solutionRecordId: uuid,
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().min(1).max(20 * 1024 * 1024),
});

const EXPORT_CODES = ["RESOURCE_NOT_FOUND", "INVALID_KIND", ...COMMON_CODES];

export async function recordSolutionRecordExportDownloadAction(
  input: unknown,
): Promise<ActionResult<{ auditId: string }>> {
  try {
    const value = parse(solutionExportSchema, input);
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("UNAUTHENTICATED");
    const { data, error } = await supabase.rpc("record_solution_record_export_download", {
      p_solution_record_id: value.solutionRecordId,
      p_artifact_hash: value.artifactHash,
      p_size_bytes: value.sizeBytes,
    });
    if (error || !data) throw new Error(error?.message ?? "EXPORT_AUDIT_FAILED");
    return { ok: true, data: { auditId: data } };
  } catch (error) {
    return actionError<{ auditId: string }>(error, [...EXPORT_CODES, "EXPORT_AUDIT_FAILED"]);
  }
}

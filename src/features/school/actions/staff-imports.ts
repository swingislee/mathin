"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { Json } from "@/lib/database.types";
import { authorizedClient } from "./guards";
import { COMMON_CODES, intInRange, parse, requiredText, uuid } from "./schemas";
import {
  STAFF_IMPORT_TEMPLATE_VERSION,
  type PreviewStaffImportInput,
  type StaffImportBatchResult,
} from "./types";

// Keep row-level business findings in the RPC. The action only rejects an
// invalid transport shape or a payload large enough to bypass importer limits.
const previewStaffImportSchema = z.object({
  templateVersion: z.literal(STAFF_IMPORT_TEMPLATE_VERSION),
  idempotencyKey: requiredText(200),
  rows: z.array(z.object({
    name: z.string().max(500),
    identifier: z.string().max(500),
    roles: z.array(z.string().max(200)).max(50),
    validDays: intInRange(1, 30),
  })).min(1).max(500),
});

const STAFF_IMPORT_CODES = [
  "INVALID_TEMPLATE",
  "INVALID_IDEMPOTENCY",
  "INVALID_ROWS",
  "IDEMPOTENCY_CONFLICT",
  "BATCH_NOT_FOUND",
  "BATCH_KIND_MISMATCH",
  "BATCH_EXPIRED",
  "BATCH_HAS_ERRORS",
  "BATCH_STALE",
  ...COMMON_CODES,
] as const;

export async function previewStaffImportAction(
  input: PreviewStaffImportInput,
): Promise<ActionResult<StaffImportBatchResult>> {
  try {
    const value = parse(previewStaffImportSchema, input);
    const inputHash = createHash("sha256").update(JSON.stringify(value.rows)).digest("hex");
    const { supabase } = await authorizedClient("staff.manage");
    const { data, error } = await supabase.rpc("preview_staff_import", {
      p_template_version: value.templateVersion,
      p_rows: value.rows as unknown as Json,
      p_idempotency_key: value.idempotencyKey,
      p_input_hash: inputHash,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: data as unknown as StaffImportBatchResult };
  } catch (error) {
    return actionError<StaffImportBatchResult>(error, STAFF_IMPORT_CODES);
  }
}

export async function applyStaffImportAction(
  batchId: string,
): Promise<ActionResult<StaffImportBatchResult>> {
  try {
    const id = parse(uuid, batchId);
    const { supabase } = await authorizedClient("staff.manage");
    const { data, error } = await supabase.rpc("apply_staff_import", { p_batch_id: id });
    if (error) throw new Error(error.message);
    return { ok: true, data: data as unknown as StaffImportBatchResult };
  } catch (error) {
    return actionError<StaffImportBatchResult>(error, STAFF_IMPORT_CODES);
  }
}

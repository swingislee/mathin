"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { Json } from "@/lib/database.types";
import { authorizedClient } from "./guards";
import {
  XIAODITUI_IMPORT_TEMPLATE_VERSION,
  type LeadImportBatchResult,
  type LeadImportDecision,
  type PreviewLeadImportInput,
} from "./types";
import { COMMON_CODES, datetime, intInRange, parse, requiredText, text, uuid } from "./schemas";

const leadImportRowSchema = z.object({
  sourceRow: intInRange(2, 100_000),
  childName: text(100),
  phone: text(40),
  grade: intInRange(1, 12).nullable(),
  gradeText: text(40),
  interestText: text(2_000),
  interests: z.array(requiredText(200)).max(20),
  wechatNickname: text(100),
  submittedAt: datetime.nullable(),
  sourceDuplicate: z.boolean(),
  acquisitionMethod: text(120),
  promoter: text(120),
  location: text(500),
  remark: text(2_000),
  orderNumber: text(120),
  paymentStatus: text(80),
  paymentAt: datetime.nullable(),
});

const previewLeadImportSchema = z.object({
  templateVersion: z.literal(XIAODITUI_IMPORT_TEMPLATE_VERSION),
  idempotencyKey: requiredText(200),
  fileName: requiredText(255),
  fileBase64: requiredText(15_000_000),
  sheetName: requiredText(120),
  batchLabel: requiredText(160),
  rows: z.array(leadImportRowSchema).min(1).max(5_000),
});

const reviewDecisionSchema = z.object({
  batchId: uuid,
  row: intInRange(1, 5_000),
  decision: z.enum(["create_new", "link_existing", "skip"]),
});

const LEAD_IMPORT_CODES = [
  "INVALID_TEMPLATE",
  "INVALID_IDEMPOTENCY",
  "INVALID_HASH",
  "INVALID_SOURCE_SYSTEM",
  "INVALID_SOURCE_METADATA",
  "INVALID_ROWS",
  "INVALID_ROW",
  "INVALID_DECISION",
  "IDEMPOTENCY_CONFLICT",
  "BATCH_NOT_FOUND",
  "BATCH_EXPIRED",
  "BATCH_HAS_ERRORS",
  "BATCH_HAS_PENDING_REVIEWS",
  "ROW_NOT_REVIEWABLE",
  ...COMMON_CODES,
] as const;

type UntypedRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

function rpc(supabase: { rpc: unknown }): UntypedRpc {
  return (supabase.rpc as UntypedRpc).bind(supabase);
}

export async function previewLeadImportAction(
  input: PreviewLeadImportInput,
): Promise<ActionResult<LeadImportBatchResult>> {
  try {
    const value = parse(previewLeadImportSchema, input);
    const bytes = Buffer.from(value.fileBase64, "base64");
    if (bytes.length === 0 || bytes.length > 10_000_000) throw new Error("VALIDATION");
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    const { supabase } = await authorizedClient("student.import");
    const { data, error } = await rpc(supabase)("preview_lead_import", {
      p_template_version: value.templateVersion,
      p_rows: value.rows as unknown as Json,
      p_idempotency_key: value.idempotencyKey,
      p_input_hash: fileHash,
      p_source_system: "xiaoditui",
      p_source_file_name: value.fileName,
      p_source_sheet_name: value.sheetName,
      p_batch_label: value.batchLabel,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: data as LeadImportBatchResult };
  } catch (error) {
    return actionError<LeadImportBatchResult>(error, LEAD_IMPORT_CODES);
  }
}

export async function getLeadImportBatchAction(
  batchId: string,
): Promise<ActionResult<LeadImportBatchResult>> {
  try {
    const id = parse(uuid, batchId);
    const { supabase } = await authorizedClient("student.import");
    const { data, error } = await rpc(supabase)("get_lead_import_batch", { p_batch_id: id });
    if (error) throw new Error(error.message);
    return { ok: true, data: data as LeadImportBatchResult };
  } catch (error) {
    return actionError<LeadImportBatchResult>(error, LEAD_IMPORT_CODES);
  }
}

export async function decideLeadImportRowAction(
  batchId: string,
  row: number,
  decision: Extract<LeadImportDecision, "create_new" | "link_existing" | "skip">,
): Promise<ActionResult<LeadImportBatchResult>> {
  try {
    const value = parse(reviewDecisionSchema, { batchId, row, decision });
    const { supabase } = await authorizedClient("student.import");
    const { data, error } = await rpc(supabase)("decide_lead_import_row", {
      p_batch_id: value.batchId,
      p_row_no: value.row,
      p_decision: value.decision,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: data as LeadImportBatchResult };
  } catch (error) {
    return actionError<LeadImportBatchResult>(error, LEAD_IMPORT_CODES);
  }
}

export async function applyLeadImportAction(batchId: string): Promise<ActionResult<LeadImportBatchResult>> {
  try {
    const id = parse(uuid, batchId);
    const { supabase } = await authorizedClient("student.import");
    const { data, error } = await rpc(supabase)("apply_lead_import", { p_batch_id: id });
    if (error) throw new Error(error.message);
    return { ok: true, data: data as LeadImportBatchResult };
  } catch (error) {
    return actionError<LeadImportBatchResult>(error, LEAD_IMPORT_CODES);
  }
}

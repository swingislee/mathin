"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { Json } from "@/lib/database.types";
import { authorizedClient } from "./guards";
import {
  MOFAXIAO_CLASS_ROSTER_IMPORT_TEMPLATE_VERSION,
  type MofaxiaoClassRosterImportBatchResult,
  type PreviewMofaxiaoClassRosterImportInput,
} from "./types";
import { COMMON_CODES, intInRange, parse, requiredText, text, uuid } from "./schemas";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const rosterDecision = z.enum(["link_existing", "create_student", "skip"]);

const mofaxiaoClassRosterRowSchema = z.object({
  sourceRow: intInRange(1, 100_000),
  sourceCell: requiredText(20),
  sourceClassKey: requiredText(200),
  sourceClassLabel: requiredText(500),
  rawName: requiredText(500),
  studentName: requiredText(100),
  sourcePhone: text(40),
  grade: intInRange(1, 12).nullable(),
  classroomId: uuid.nullable(),
  decision: rosterDecision,
  studentId: uuid.nullable(),
  sourceNote: text(500),
}).strict().superRefine((row, context) => {
  if (row.decision !== "skip" && !row.classroomId) {
    context.addIssue({ code: "custom", path: ["classroomId"], message: "MISSING_CLASSROOM_MAPPING" });
  }
  if (row.decision === "link_existing" && !row.studentId) {
    context.addIssue({ code: "custom", path: ["studentId"], message: "MISSING_STUDENT_MAPPING" });
  }
  if (row.decision !== "link_existing" && row.studentId) {
    context.addIssue({ code: "custom", path: ["studentId"], message: "INVALID_STUDENT_MAPPING" });
  }
});

const previewMofaxiaoClassRosterImportSchema = z.object({
  templateVersion: z.literal(MOFAXIAO_CLASS_ROSTER_IMPORT_TEMPLATE_VERSION),
  idempotencyKey: requiredText(200),
  fileName: requiredText(255),
  fileHash: sha256,
  sheetName: requiredText(120),
  batchLabel: requiredText(160),
  rows: z.array(mofaxiaoClassRosterRowSchema).min(1).max(5_000),
}).strict();

const MOFAXIAO_CLASS_ROSTER_IMPORT_CODES = [
  "INVALID_TEMPLATE",
  "INVALID_IDEMPOTENCY",
  "INVALID_HASH",
  "INVALID_SOURCE_SYSTEM",
  "INVALID_SOURCE_METADATA",
  "INVALID_ROWS",
  "IDEMPOTENCY_CONFLICT",
  "BATCH_NOT_FOUND",
  "BATCH_EXPIRED",
  "BATCH_HAS_ERRORS",
  "BATCH_KIND_MISMATCH",
  "MISSING_CLASSROOM_MAPPING",
  "INVALID_CLASSROOM",
  "CLASS_TERM_MISSING",
  "MISSING_STUDENT_MAPPING",
  "INVALID_STUDENT_MAPPING",
  "INVALID_STUDENT",
  "STUDENT_IMPORT_FORBIDDEN",
  "CLASS_CAPACITY_EXCEEDED",
  "DUPLICATE_IN_BATCH",
  "ALREADY_ENROLLED",
  ...COMMON_CODES,
] as const;

type UntypedRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

function rpc(supabase: { rpc: unknown }): UntypedRpc {
  return (supabase.rpc as UntypedRpc).bind(supabase);
}

export async function previewMofaxiaoClassRosterImportAction(
  input: PreviewMofaxiaoClassRosterImportInput,
): Promise<ActionResult<MofaxiaoClassRosterImportBatchResult>> {
  try {
    const value = parse(previewMofaxiaoClassRosterImportSchema, input);
    const inputHash = createHash("sha256").update(JSON.stringify(value.rows)).digest("hex");
    const { supabase } = await authorizedClient("enrollment.manage");
    const { data, error } = await rpc(supabase)("preview_mofaxiao_class_roster_import", {
      p_template_version: value.templateVersion,
      p_rows: value.rows as unknown as Json,
      p_idempotency_key: value.idempotencyKey,
      p_input_hash: inputHash,
      p_file_hash: value.fileHash,
      p_source_system: "mofaxiao",
      p_source_file_name: value.fileName,
      p_source_sheet_name: value.sheetName,
      p_batch_label: value.batchLabel,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: data as MofaxiaoClassRosterImportBatchResult };
  } catch (error) {
    return actionError<MofaxiaoClassRosterImportBatchResult>(error, MOFAXIAO_CLASS_ROSTER_IMPORT_CODES);
  }
}

export async function getMofaxiaoClassRosterImportBatchAction(
  batchId: string,
): Promise<ActionResult<MofaxiaoClassRosterImportBatchResult>> {
  try {
    const id = parse(uuid, batchId);
    const { supabase } = await authorizedClient("enrollment.manage");
    const { data, error } = await rpc(supabase)("get_mofaxiao_class_roster_import_batch", { p_batch_id: id });
    if (error) throw new Error(error.message);
    return { ok: true, data: data as MofaxiaoClassRosterImportBatchResult };
  } catch (error) {
    return actionError<MofaxiaoClassRosterImportBatchResult>(error, MOFAXIAO_CLASS_ROSTER_IMPORT_CODES);
  }
}

export async function applyMofaxiaoClassRosterImportAction(
  batchId: string,
): Promise<ActionResult<MofaxiaoClassRosterImportBatchResult>> {
  try {
    const id = parse(uuid, batchId);
    const { supabase } = await authorizedClient("enrollment.manage");
    const { data, error } = await rpc(supabase)("apply_mofaxiao_class_roster_import", { p_batch_id: id });
    if (error) throw new Error(error.message);
    return { ok: true, data: data as MofaxiaoClassRosterImportBatchResult };
  } catch (error) {
    return actionError<MofaxiaoClassRosterImportBatchResult>(error, MOFAXIAO_CLASS_ROSTER_IMPORT_CODES);
  }
}

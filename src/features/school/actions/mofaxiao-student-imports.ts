"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { Json } from "@/lib/database.types";
import { authorizedClient } from "./guards";
import {
  MOFAXIAO_STUDENT_IMPORT_TEMPLATE_VERSION,
  type MofaxiaoStudentImportBatchResult,
  type PreviewMofaxiaoStudentImportInput,
} from "./types";
import { COMMON_CODES, dateOnly, intInRange, parse, requiredText, text, uuid } from "./schemas";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

const mofaxiaoStudentRowSchema = z.object({
  sourceRow: intInRange(2, 100_000),
  externalStudentId: text(1_000),
  name: text(1_000),
  phone: text(40),
  phoneMasked: z.boolean(),
  phoneInvalid: z.boolean(),
  gender: text(100),
  birthday: dateOnly.nullable(),
  birthdayText: text(100),
  school: text(1_000),
  publicSchoolClass: text(1_000),
  grade: intInRange(1, 12).nullable(),
  gradeText: text(100),
  gradeUnmapped: z.boolean(),
  parentName: text(1_000),
  parentRelation: text(200),
  parentPhone: text(40),
  parentPhoneMasked: z.boolean(),
  parentPhoneInvalid: z.boolean(),
  remark: text(10_000),
  source: text(1_000),
  marketActivity: text(1_000),
  tags: z.array(requiredText(500)).max(3),
}).strict();

const previewMofaxiaoStudentImportSchema = z.object({
  templateVersion: z.literal(MOFAXIAO_STUDENT_IMPORT_TEMPLATE_VERSION),
  idempotencyKey: requiredText(200),
  fileName: requiredText(255),
  fileHash: sha256,
  sheetName: requiredText(120),
  batchLabel: requiredText(160),
  rows: z.array(mofaxiaoStudentRowSchema).min(1).max(5_000),
}).strict();

const MOFAXIAO_IMPORT_CODES = [
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
  ...COMMON_CODES,
] as const;

type UntypedRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

function rpc(supabase: { rpc: unknown }): UntypedRpc {
  return (supabase.rpc as UntypedRpc).bind(supabase);
}

export async function previewMofaxiaoStudentImportAction(
  input: PreviewMofaxiaoStudentImportInput,
): Promise<ActionResult<MofaxiaoStudentImportBatchResult>> {
  try {
    const value = parse(previewMofaxiaoStudentImportSchema, input);
    const inputHash = createHash("sha256").update(JSON.stringify(value.rows)).digest("hex");
    const { supabase } = await authorizedClient("student.import");
    const { data, error } = await rpc(supabase)("preview_mofaxiao_student_import", {
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
    return { ok: true, data: data as MofaxiaoStudentImportBatchResult };
  } catch (error) {
    return actionError<MofaxiaoStudentImportBatchResult>(error, MOFAXIAO_IMPORT_CODES);
  }
}

export async function getMofaxiaoStudentImportBatchAction(
  batchId: string,
): Promise<ActionResult<MofaxiaoStudentImportBatchResult>> {
  try {
    const id = parse(uuid, batchId);
    const { supabase } = await authorizedClient("student.import");
    const { data, error } = await rpc(supabase)("get_mofaxiao_student_import_batch", { p_batch_id: id });
    if (error) throw new Error(error.message);
    return { ok: true, data: data as MofaxiaoStudentImportBatchResult };
  } catch (error) {
    return actionError<MofaxiaoStudentImportBatchResult>(error, MOFAXIAO_IMPORT_CODES);
  }
}

export async function applyMofaxiaoStudentImportAction(
  batchId: string,
): Promise<ActionResult<MofaxiaoStudentImportBatchResult>> {
  try {
    const id = parse(uuid, batchId);
    const { supabase } = await authorizedClient("student.import");
    const { data, error } = await rpc(supabase)("apply_mofaxiao_student_import", { p_batch_id: id });
    if (error) throw new Error(error.message);
    return { ok: true, data: data as MofaxiaoStudentImportBatchResult };
  } catch (error) {
    return actionError<MofaxiaoStudentImportBatchResult>(error, MOFAXIAO_IMPORT_CODES);
  }
}

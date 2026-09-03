"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { Json } from "@/lib/database.types";
import { authorizedClient } from "./guards";
import {
  MOFAXIAO_CLASS_IMPORT_TEMPLATE_VERSION,
  type MofaxiaoClassImportBatchResult,
  type PreviewMofaxiaoClassImportInput,
} from "./types";
import { COMMON_CODES, dateOnly, intInRange, parse, requiredText, text, uuid } from "./schemas";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

const mofaxiaoClassRowSchema = z.object({
  sourceRow: intInRange(2, 100_000),
  externalClassId: text(1_000),
  name: text(1_000),
  teachingMode: text(200),
  courseName: text(1_000),
  courseType: text(200),
  progressText: text(200),
  subject: text(200),
  grade: intInRange(1, 12).nullable(),
  gradeText: text(200),
  gradeUnmapped: z.boolean(),
  season: intInRange(1, 4).nullable(),
  seasonText: text(200),
  classType: text(200),
  assessmentDifficulty: text(200),
  teacherName: text(1_000),
  campusName: text(1_000),
  roomName: text(1_000),
  feeText: text(200),
  currentStudentCount: intInRange(0, 100_000).nullable(),
  enrolledCount: intInRange(0, 100_000).nullable(),
  capacity: intInRange(1, 500).nullable(),
  capacityInvalid: z.boolean(),
  sourceStatus: text(200),
  startDate: dateOnly.nullable(),
  startDateText: text(200),
  endDate: dateOnly.nullable(),
  endDateText: text(200),
  sessionTime: text(200),
  purchasedText: text(200),
  courseId: uuid.nullable(),
  importAsFreeClass: z.boolean(),
  primaryTeacherId: uuid.nullable(),
  roomId: uuid.nullable(),
  schoolTermId: uuid.nullable(),
}).strict();

const previewMofaxiaoClassImportSchema = z.object({
  templateVersion: z.literal(MOFAXIAO_CLASS_IMPORT_TEMPLATE_VERSION),
  idempotencyKey: requiredText(200),
  fileName: requiredText(255),
  fileHash: sha256,
  sheetName: requiredText(120),
  batchLabel: requiredText(160),
  rows: z.array(mofaxiaoClassRowSchema).min(1).max(5_000),
}).strict();

const MOFAXIAO_CLASS_IMPORT_CODES = [
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
  "INVALID_NAME",
  "INVALID_CAPACITY",
  "INVALID_STAFF",
  "INVALID_ROOM",
  "INVALID_SCHOOL_TERM",
  "COURSE_NOT_AVAILABLE",
  "INVALID_OFFERING_TYPE",
  ...COMMON_CODES,
] as const;

type UntypedRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

function rpc(supabase: { rpc: unknown }): UntypedRpc {
  return (supabase.rpc as UntypedRpc).bind(supabase);
}

export async function previewMofaxiaoClassImportAction(
  input: PreviewMofaxiaoClassImportInput,
): Promise<ActionResult<MofaxiaoClassImportBatchResult>> {
  try {
    const value = parse(previewMofaxiaoClassImportSchema, input);
    const inputHash = createHash("sha256").update(JSON.stringify(value.rows)).digest("hex");
    const { supabase } = await authorizedClient("class.create");
    const { data, error } = await rpc(supabase)("preview_mofaxiao_class_import", {
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
    return { ok: true, data: data as MofaxiaoClassImportBatchResult };
  } catch (error) {
    return actionError<MofaxiaoClassImportBatchResult>(error, MOFAXIAO_CLASS_IMPORT_CODES);
  }
}

export async function getMofaxiaoClassImportBatchAction(
  batchId: string,
): Promise<ActionResult<MofaxiaoClassImportBatchResult>> {
  try {
    const id = parse(uuid, batchId);
    const { supabase } = await authorizedClient("class.create");
    const { data, error } = await rpc(supabase)("get_mofaxiao_class_import_batch", { p_batch_id: id });
    if (error) throw new Error(error.message);
    return { ok: true, data: data as MofaxiaoClassImportBatchResult };
  } catch (error) {
    return actionError<MofaxiaoClassImportBatchResult>(error, MOFAXIAO_CLASS_IMPORT_CODES);
  }
}

export async function applyMofaxiaoClassImportAction(
  batchId: string,
): Promise<ActionResult<MofaxiaoClassImportBatchResult>> {
  try {
    const id = parse(uuid, batchId);
    const { supabase } = await authorizedClient("class.create");
    const { data, error } = await rpc(supabase)("apply_mofaxiao_class_import", { p_batch_id: id });
    if (error) throw new Error(error.message);
    return { ok: true, data: data as MofaxiaoClassImportBatchResult };
  } catch (error) {
    return actionError<MofaxiaoClassImportBatchResult>(error, MOFAXIAO_CLASS_IMPORT_CODES);
  }
}

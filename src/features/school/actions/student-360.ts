"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { Student360Snapshot, Student360SubjectRef } from "../student-360-contract";
import { getStudent360Snapshot } from "../student-360";
import { COMMON_CODES, parse, uuid } from "./schemas";

const student360SubjectSchema = z.object({
  studentId: uuid.nullable(),
  leadId: uuid.nullable(),
}).refine((subject) => Number(Boolean(subject.studentId)) + Number(Boolean(subject.leadId)) === 1);

export async function getStudent360Action(
  subject: Student360SubjectRef,
): Promise<ActionResult<Student360Snapshot>> {
  try {
    const value = parse(student360SubjectSchema, subject);
    const snapshot = await getStudent360Snapshot(value);
    return { ok: true, data: snapshot };
  } catch (error) {
    return actionError<Student360Snapshot>(error, [
      ...COMMON_CODES,
      "NOT_FOUND",
      "SUBJECT_MISMATCH",
    ]);
  }
}

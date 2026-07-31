"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "@/features/school/actions/guards";
import { COMMON_CODES, parse, requiredText, uuid } from "@/features/school/actions/schemas";
import { LEARNING_CHECK_STATUSES } from "./session-learning-contract";

const replaceChecksSchema = z.object({
  sessionId: uuid,
  items: z.array(z.object({
    title: requiredText(100),
    sourcePageId: uuid.nullable(),
  })).max(30),
});

export async function replaceSessionLearningChecksAction(input: {
  sessionId: string;
  items: Array<{ title: string; sourcePageId: string | null }>;
}): Promise<ActionResult> {
  try {
    const value = parse(replaceChecksSchema, input);
    const { supabase } = await authorizedClient("attendance.mark");
    const { error } = await supabase.rpc("replace_session_learning_checks", {
      p_session_id: value.sessionId,
      p_titles: value.items,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["SESSION_NOT_FOUND", "SESSION_ALREADY_STARTED", ...COMMON_CODES]);
  }
}

const markChecksSchema = z.object({
  sessionId: uuid,
  checkId: uuid,
  studentIds: z.array(uuid).min(1).max(30),
  status: z.enum(LEARNING_CHECK_STATUSES),
});

export async function markSessionLearningChecksAction(input: {
  sessionId: string;
  checkId: string;
  studentIds: string[];
  status: (typeof LEARNING_CHECK_STATUSES)[number];
}): Promise<ActionResult> {
  try {
    const value = parse(markChecksSchema, input);
    const { supabase } = await authorizedClient("attendance.mark");
    const writes = await Promise.all(value.studentIds.map((studentId) =>
      supabase.rpc("mark_session_learning_check", {
        p_session_id: value.sessionId,
        p_check_id: value.checkId,
        p_student_id: studentId,
        p_status: value.status,
      }),
    ));
    const failed = writes.find((write) => write.error);
    if (failed?.error) throw new Error(failed.error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["NOT_FOUND", "STUDENT_NOT_ENROLLED", "FORBIDDEN", ...COMMON_CODES]);
  }
}

const saveSeatOrderSchema = z.object({
  sessionId: uuid,
  studentIds: z.array(uuid).min(1).max(60),
});

export async function saveClassroomStudentSeatOrderAction(input: {
  sessionId: string;
  studentIds: string[];
}): Promise<ActionResult> {
  try {
    const value = parse(saveSeatOrderSchema, input);
    const { supabase } = await authorizedClient("attendance.mark");
    const { error } = await supabase.rpc("save_classroom_student_seat_order", {
      p_session_id: value.sessionId,
      p_student_ids: value.studentIds,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["SESSION_NOT_FOUND", "ROSTER_CHANGED", ...COMMON_CODES]);
  }
}

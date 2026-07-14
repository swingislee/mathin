"use server";

// ---------------------------------------------------------------------------
// 跟进时间线（P4B-2 §8：教师与学辅的日常写入口）。RLS 第三道兜底：
// followups_insert_staff_scope 只放行我作用域内学生；students 冗余字段由触发器更新。
// ---------------------------------------------------------------------------

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { FOLLOW_UP_STATUSES } from "../students";
import { authorizedClient } from "./guards";
import { COMMON_CODES, datetime, parse, requiredText, uuid } from "./schemas";
import { FOLLOW_UP_KINDS, type FollowUpKind } from "./types";

const followUpSchema = z.object({
  studentId: uuid,
  content: requiredText(2000),
  kind: z.enum(FOLLOW_UP_KINDS),
  nextFollowUpAt: datetime.nullable(),
  statusAfter: z.enum(FOLLOW_UP_STATUSES).nullable(),
});

export async function addStudentFollowUp(
  studentId: string,
  input: { content: string; kind: FollowUpKind; nextFollowUpAt: string | null; statusAfter: string | null },
): Promise<ActionResult> {
  try {
    const value = parse(followUpSchema, { studentId, ...input });
    const { supabase, user } = await authorizedClient("followup.write");
    const { error } = await supabase.from("student_follow_ups").insert({
      student_id: value.studentId,
      author_id: user.id,
      content: value.content,
      kind: value.kind,
      next_follow_up_at: value.nextFollowUpAt,
      status_after: value.statusAfter,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

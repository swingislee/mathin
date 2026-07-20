"use server";

// ---------------------------------------------------------------------------
// classroom_staff_assignments 管理（P4H-9）。RPC（assign_classroom_staff /
// remove_classroom_staff）在 P4H-2 已建好，此前零调用方。
// ---------------------------------------------------------------------------

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "./guards";
import { COMMON_CODES, parse, uuid } from "./schemas";

const responsibilitySchema = z.enum(["primary_teacher", "assistant_teacher", "learning_support"]);

const assignSchema = z.object({ classroomId: uuid, userId: uuid, responsibility: responsibilitySchema });

export async function assignClassroomStaffAction(
  classroomId: string,
  userId: string,
  responsibility: z.infer<typeof responsibilitySchema>,
): Promise<ActionResult> {
  try {
    const value = parse(assignSchema, { classroomId, userId, responsibility });
    const { supabase } = await authorizedClient("class.manage");
    const { error } = await supabase.rpc("assign_classroom_staff", {
      p_classroom_id: value.classroomId,
      p_user_id: value.userId,
      p_responsibility: value.responsibility,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["INVALID_STAFF", "FORBIDDEN_SCOPE", "CLASSROOM_NOT_FOUND", ...COMMON_CODES]);
  }
}

const removeSchema = z.object({ classroomId: uuid, userId: uuid, responsibility: responsibilitySchema });

export async function removeClassroomStaffAction(
  classroomId: string,
  userId: string,
  responsibility: z.infer<typeof responsibilitySchema>,
): Promise<ActionResult> {
  try {
    const value = parse(removeSchema, { classroomId, userId, responsibility });
    const { supabase } = await authorizedClient("class.manage");
    const { error } = await supabase.rpc("remove_classroom_staff", {
      p_classroom_id: value.classroomId,
      p_user_id: value.userId,
      p_responsibility: value.responsibility,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["PRIMARY_REPLACEMENT_REQUIRED", "ASSIGNMENT_NOT_FOUND", "FORBIDDEN_SCOPE", "CLASSROOM_NOT_FOUND", ...COMMON_CODES]);
  }
}

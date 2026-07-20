"use server";

// ---------------------------------------------------------------------------
// 测试数据批量归档与受控永久清理（P4H-10）。purge 系动作走 testdata.purge 权限
// 键——目前没有任何 staff role 被授予它，这条通道默认对所有账号都不可达。
// ---------------------------------------------------------------------------

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "./guards";
import { COMMON_CODES, parse, requiredText, uuid } from "./schemas";

const bulkArchiveSchema = z.object({
  classroomIds: z.array(uuid).min(1).max(200),
  archived: z.boolean(),
});

export async function bulkArchiveClassroomsAction(classroomIds: string[], archived: boolean): Promise<ActionResult> {
  try {
    const value = parse(bulkArchiveSchema, { classroomIds, archived });
    const { supabase } = await authorizedClient("class.manage");
    const { error } = await supabase.rpc("bulk_archive_test_classrooms", {
      p_classroom_ids: value.classroomIds,
      p_archived: value.archived,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["INVALID_SELECTION", "PRODUCTION_DATA_PROTECTED", "FORBIDDEN_SCOPE", "CLASSROOM_NOT_FOUND", ...COMMON_CODES]);
  }
}

const purgeFamilySchema = z.object({ familyId: uuid, confirmName: requiredText(200) });

export async function purgeTestCourseFamilyAction(familyId: string, confirmName: string): Promise<ActionResult> {
  try {
    const value = parse(purgeFamilySchema, { familyId, confirmName });
    const { supabase } = await authorizedClient("testdata.purge");
    const { error } = await supabase.rpc("purge_test_course_family", {
      p_family_id: value.familyId,
      p_confirm_name: value.confirmName,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, [
      "PRODUCTION_DATA_PROTECTED", "VARIANT_NOT_TRASHED", "COURSE_IN_USE",
      "COURSE_HAS_REPLACEMENT_HISTORY", "NAME_MISMATCH", "COURSE_FAMILY_NOT_FOUND",
      ...COMMON_CODES,
    ]);
  }
}

const purgeClassroomSchema = z.object({ classroomId: uuid, confirmName: requiredText(200) });

export async function purgeTestClassroomAction(classroomId: string, confirmName: string): Promise<ActionResult> {
  try {
    const value = parse(purgeClassroomSchema, { classroomId, confirmName });
    const { supabase } = await authorizedClient("testdata.purge");
    const { error } = await supabase.rpc("purge_test_classroom", {
      p_classroom_id: value.classroomId,
      p_confirm_name: value.confirmName,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, [
      "PRODUCTION_DATA_PROTECTED", "CLASSROOM_NOT_TRASHED", "CLASSROOM_HAS_HISTORY",
      "NAME_MISMATCH", "CLASSROOM_NOT_FOUND", ...COMMON_CODES,
    ]);
  }
}

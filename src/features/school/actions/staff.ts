"use server";

// ---------------------------------------------------------------------------
// 员工与岗位权限（P4C-3 §8）。写入全部走 security definer RPC，RPC 自己做
// 「不能改自己 / 不能动系统角色 / 不能删最后一个 admin」这类不变量。
// ---------------------------------------------------------------------------

import { z } from "zod";
import { getProfile } from "@/lib/auth";
import { actionError, type ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { isPermissionKey } from "../permissions";
import { authorizedClient, nullableRpcArg } from "./guards";
import { COMMON_CODES, parse, requiredText, uuid } from "./schemas";
import type { FoundProfile, StaffHandoverPreview } from "./types";

/** 服务端错误码白名单：Server Action 抛错在生产会被脱敏，故用返回值把已知码带回 UI 翻译成 toast。 */
const STAFF_ERROR_CODES = new Set([
  "VALIDATION",
  "FORBIDDEN",
  "CANNOT_GRANT_SELF",
  "CANNOT_REVOKE_SELF",
  "CANNOT_CHANGE_SELF",
  "TARGET_NOT_STAFF",
  "NOT_FOUND",
  "ROLE_NOT_FOUND",
  "INVALID_NAME",
  "SYSTEM_ROLE",
  "ROLE_HAS_MEMBERS",
  "INVALID_PERMISSION_KEYS",
  "INVALID_ROLE",
  "INVALID_REPLACEMENT",
  "LAST_ACTIVE_ADMIN",
]);

function staffResult(error: { message: string } | null): ActionResult {
  if (!error) return { ok: true };
  return { ok: false, code: STAFF_ERROR_CODES.has(error.message) ? error.message : "UNKNOWN" };
}

/** 服务端错误码转 ActionResult 的统一 catch：authorizedClient 的 UNAUTHENTICATED/FORBIDDEN 与 parse 的 VALIDATION 也走这里。 */
function staffCatch(error: unknown): ActionResult {
  return { ok: false, code: error instanceof Error && STAFF_ERROR_CODES.has(error.message) ? error.message : "UNKNOWN" };
}

/** 按邮箱精确查找账号（添加员工入口）。邮箱只走 POST 体，不写日志、不进 URL。 */
export async function findProfileByEmailAction(email: string): Promise<ActionResult<FoundProfile | null>> {
  try {
    const { supabase } = await authorizedClient("staff.manage");
    const trimmed = email.trim();
    if (!trimmed) return { ok: true, data: null };
    const value = parse(z.email().max(254), trimmed);
    const { data, error } = await supabase.rpc("find_profile_by_email", { p: value });
    if (error) throw new Error("LOOKUP_FAILED");
    const row = ((data ?? []) as Array<{ user_id: string; display_name: string; identity: FoundProfile["identity"] }>)[0];
    return { ok: true, data: row ? { userId: row.user_id, displayName: row.display_name, identity: row.identity } : null };
  } catch (error) {
    return actionError<FoundProfile | null>(error, ["LOOKUP_FAILED", ...COMMON_CODES]);
  }
}

export async function grantStaffRoleAction(target: string, roleId: string): Promise<ActionResult> {
  try {
    const value = parse(z.object({ target: uuid, roleId: uuid }), { target, roleId });
    const { supabase } = await authorizedClient("staff.manage");
    const { error } = await supabase.rpc("grant_staff_role", { target: value.target, p_role_id: value.roleId });
    return staffResult(error);
  } catch (error) {
    return staffCatch(error);
  }
}

export async function revokeStaffRoleAction(target: string, roleId: string): Promise<ActionResult> {
  try {
    const value = parse(z.object({ target: uuid, roleId: uuid }), { target, roleId });
    const { supabase } = await authorizedClient("staff.manage");
    const { error } = await supabase.rpc("revoke_staff_role", { target: value.target, p_role_id: value.roleId });
    return staffResult(error);
  } catch (error) {
    return staffCatch(error);
  }
}

/** 提升为员工身份：双闸——UI 仅 admin 可见，RPC 本身也仅 admin（docs/plan/11 §10 员工页层）。 */
export async function promoteToStaffAction(target: string): Promise<ActionResult> {
  try {
    const targetId = parse(uuid, target);
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("UNAUTHENTICATED");
    const profile = await getProfile(user.id);
    if (profile?.role !== "admin") return { ok: false, code: "FORBIDDEN" };
    const { error } = await supabase.rpc("admin_set_identity", { target: targetId, new_role: "staff" });
    return staffResult(error);
  } catch (error) {
    return staffCatch(error);
  }
}

export async function createStaffRoleAction(name: string): Promise<ActionResult<{ roleId: string }>> {
  try {
    const value = parse(requiredText(50), name);
    const { supabase } = await authorizedClient("permission.configure");
    const { data, error } = await supabase.rpc("create_staff_role", { p_name: value });
    if (error) throw new Error(error.message);
    return { ok: true, data: { roleId: data as string } };
  } catch (error) {
    return { ok: false, code: error instanceof Error && STAFF_ERROR_CODES.has(error.message) ? error.message : "UNKNOWN" };
  }
}

export async function renameStaffRoleAction(roleId: string, name: string): Promise<ActionResult> {
  try {
    const value = parse(z.object({ roleId: uuid, name: requiredText(50) }), { roleId, name });
    const { supabase } = await authorizedClient("permission.configure");
    const { error } = await supabase.rpc("rename_staff_role", { role_id: value.roleId, p_name: value.name });
    return staffResult(error);
  } catch (error) {
    return staffCatch(error);
  }
}

export async function deleteStaffRoleAction(roleId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, roleId);
    const { supabase } = await authorizedClient("permission.configure");
    const { error } = await supabase.rpc("delete_staff_role", { role_id: id });
    return staffResult(error);
  } catch (error) {
    return staffCatch(error);
  }
}

export async function setRolePermissionsAction(roleId: string, keys: string[]): Promise<ActionResult> {
  try {
    const value = parse(z.object({ roleId: uuid, keys: z.array(z.string().max(64)).max(200) }), { roleId, keys });
    const { supabase } = await authorizedClient("permission.configure");
    const cleanKeys = value.keys.filter(isPermissionKey);
    if (cleanKeys.length !== value.keys.length) return { ok: false, code: "INVALID_PERMISSION_KEYS" };
    const { error } = await supabase.rpc("set_role_permissions", { p_role_id: value.roleId, perm_keys: cleanKeys });
    return staffResult(error);
  } catch (error) {
    return staffCatch(error);
  }
}

export async function deactivateStaffAction(target: string, reassignTo: string | null): Promise<ActionResult> {
  try {
    const value = parse(z.object({ target: uuid, reassignTo: uuid.nullable() }), { target, reassignTo });
    const { supabase } = await authorizedClient("staff.manage");
    const { error } = await supabase.rpc("deactivate_staff", {
      p_target: value.target,
      p_reassign_to: nullableRpcArg(value.reassignTo),
    });
    return staffResult(error);
  } catch (error) {
    return staffCatch(error);
  }
}

export async function getStaffHandoverPreviewAction(target: string): Promise<StaffHandoverPreview> {
  const targetId = parse(uuid, target);
  const { supabase } = await authorizedClient("staff.manage");
  const { data, error } = await supabase.rpc("get_staff_handover_preview", { p_target: targetId });
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as { student_count: number; future_override_count: number; classroom_count: number } | undefined;
  return {
    studentCount: Number(row?.student_count ?? 0),
    futureOverrideCount: Number(row?.future_override_count ?? 0),
    classroomCount: Number(row?.classroom_count ?? 0),
  };
}

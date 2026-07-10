import { createClient } from "@/lib/supabase/server";
import { isPermissionKey, type PermissionKey } from "./permissions";

// P4C-3（docs/plan/11 §8）：员工页与岗位权限页的读侧。

export interface StaffMember {
  userId: string;
  displayName: string;
  email: string;
  identity: "staff" | "admin";
  roleIds: string[];
  roleNames: string[];
}

interface StaffMemberRpcRow {
  user_id: string;
  display_name: string;
  email: string;
  identity: "staff" | "admin";
  role_ids: string[];
  role_names: string[];
}

/** 员工列表（RPC 内 staff.manage 门控；无权限得空集）。admin 置顶，其余按姓名排。 */
export async function listStaffMembers(): Promise<StaffMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_staff_members");
  if (error) throw new Error(error.message);
  return ((data ?? []) as StaffMemberRpcRow[])
    .map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      email: row.email,
      identity: row.identity,
      roleIds: row.role_ids ?? [],
      roleNames: row.role_names ?? [],
    }))
    .sort((a, b) =>
      a.identity !== b.identity ? (a.identity === "admin" ? -1 : 1) : a.displayName.localeCompare(b.displayName, "zh"),
    );
}

export interface StaffRoleInfo {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
  /** 按调用者 RLS 可见范围计数（staff.manage 见全量；仅 permission.configure 时可能偏小，仅作展示）。 */
  memberCount: number;
  permKeys: PermissionKey[];
}

/** 角色列表 + 权限键 + 成员数（staff_roles/role_permissions 表对 staff 开放 select RLS）。 */
export async function listStaffRoles(): Promise<StaffRoleInfo[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff_roles")
    .select("id,key,name,is_system,role_permissions(perm_key),staff_role_members(user_id)")
    .order("created_at", { ascending: true })
    .returns<
      Array<{
        id: string;
        key: string;
        name: string;
        is_system: boolean;
        role_permissions: Array<{ perm_key: string }>;
        staff_role_members: Array<{ user_id: string }>;
      }>
    >();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    isSystem: row.is_system,
    memberCount: row.staff_role_members.length,
    permKeys: row.role_permissions.map((p) => p.perm_key).filter(isPermissionKey),
  }));
}

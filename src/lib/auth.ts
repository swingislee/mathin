import { redirect } from "next/navigation";
import { cache } from "react";
import { PERMISSION_KEYS, type PermissionKey } from "@/features/school/permissions";
import type { UserEnvironment } from "@/lib/environment";
import { createClient } from "@/lib/supabase/server";

export type ProfileRole = "student" | "parent" | "staff" | "admin";

export interface Profile {
  id: string;
  role: ProfileRole;
  displayName: string;
  avatarUrl: string | null;
  lastActiveEnvironment: UserEnvironment;
}

export async function requireUser(locale: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);
  return user;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id,role,display_name,avatar_url,last_active_environment")
    .eq("id", userId)
    .maybeSingle<{
      id: string;
      role: ProfileRole;
      display_name: string;
      avatar_url: string | null;
      last_active_environment: UserEnvironment;
    }>();
  if (!data) return null;
  return {
    id: data.id,
    role: data.role,
    displayName: data.display_name,
    avatarUrl: data.avatar_url,
    lastActiveEnvironment: data.last_active_environment,
  };
}

export const getMyPerms = cache(async (userId: string): Promise<Set<PermissionKey>> => {
  const profile = await getProfile(userId);
  if (!profile) return new Set();
  if (profile.role === "admin") return new Set(PERMISSION_KEYS);
  if (profile.role !== "staff") return new Set();

  const supabase = await createClient();
  const { data } = await supabase
    .from("staff_role_members")
    .select("staff_roles(role_permissions(perm_key))")
    .eq("user_id", userId)
    .returns<Array<{ staff_roles: { role_permissions: Array<{ perm_key: string }> } | null }>>();

  const perms = new Set<PermissionKey>();
  for (const row of data ?? []) {
    for (const permission of row.staff_roles?.role_permissions ?? []) {
      if ((PERMISSION_KEYS as readonly string[]).includes(permission.perm_key)) {
        perms.add(permission.perm_key as PermissionKey);
      }
    }
  }
  return perms;
});

export async function requirePerm(locale: string, key: PermissionKey) {
  const user = await requireUser(locale);
  const perms = await getMyPerms(user.id);
  if (!perms.has(key)) redirect(`/${locale}/dashboard`);
  return user;
}

export async function requireAnyPerm(locale: string, keys: readonly PermissionKey[]) {
  const user = await requireUser(locale);
  const perms = await getMyPerms(user.id);
  if (!keys.some((key) => perms.has(key))) redirect(`/${locale}/dashboard`);
  return user;
}

/** P4I-8 起是员工工作台入口的统一闸门：profiles.role 的员工身份为 staff/admin。 */
export async function requireStaff(locale: string) {
  const user = await requireUser(locale);
  const profile = await getProfile(user.id);
  if (profile?.role !== "staff" && profile?.role !== "admin") redirect(`/${locale}/dashboard`);
  return user;
}

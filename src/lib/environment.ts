import type { ProfileRole } from "@/lib/auth";
import type { createClient } from "@/lib/supabase/server";

/**
 * P4I §2.5/§3.6/§19.1：使用环境（staff/family/learning），不是岗位/角色。
 * 同一账号可能同时属于多个环境（例如 staff 账号也是某个学生的监护人），
 * 切换环境不改变 profiles.role 或任何权限判定。
 */
export type UserEnvironment = "staff" | "family" | "learning";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const ENVIRONMENT_PRIORITY: readonly UserEnvironment[] = ["staff", "family", "learning"];

export function isUserEnvironment(value: unknown): value is UserEnvironment {
  return value === "staff" || value === "family" || value === "learning";
}

/** 账号当前实际可用的环境集合，按关系推导，不新增/复用"当前角色"字段。 */
export async function resolveAvailableEnvironments(
  supabase: Supabase,
  userId: string,
  role: ProfileRole | null | undefined,
): Promise<UserEnvironment[]> {
  const environments: UserEnvironment[] = [];
  if (role === "staff" || role === "admin") environments.push("staff");

  if (role === "parent") {
    environments.push("family");
  } else {
    const { count } = await supabase
      .from("student_guardians")
      .select("student_id", { count: "exact", head: true })
      .eq("guardian_id", userId);
    if ((count ?? 0) > 0) environments.push("family");
  }

  if (role === "student") environments.push("learning");

  return environments;
}

/** 偏好在可用集合内则用偏好；否则按固定优先级取第一个可用环境。 */
export function pickActiveEnvironment(
  preference: string | null | undefined,
  available: readonly UserEnvironment[],
): UserEnvironment | null {
  if (isUserEnvironment(preference) && available.includes(preference)) return preference;
  return ENVIRONMENT_PRIORITY.find((env) => available.includes(env)) ?? null;
}

import "server-only";

import { getMyPerms } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { PermissionKey } from "../permissions";

/** 校验闸：登录 + 功能权限键（两道闸的第二道，第一道靠 requirePerm 挡在页面级；RLS 第三道兜底）。 */
export async function authorizedClient(key: PermissionKey) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const perms = await getMyPerms(user.id);
  if (!perms.has(key)) throw new Error("FORBIDDEN");
  return { supabase, user };
}

/** 任一财务功能键即放行（与 authorizedClient 的单键模式不同，财务多个 tab 各管各的键）。 */
export async function financeClient(keys: PermissionKey[]) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const perms = await getMyPerms(user.id);
  if (!keys.some((key) => perms.has(key))) throw new Error("FORBIDDEN");
  return { supabase, user };
}

// PostgreSQL functions accept NULL unless their body rejects it, but pg-meta's
// generated Args type cannot represent a nullable, required function argument.
// Keep the runtime NULL while narrowing only that generator limitation.
export function nullableRpcArg<T>(value: T | null): T {
  return value as T;
}

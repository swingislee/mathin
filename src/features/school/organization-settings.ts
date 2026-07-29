import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { OrganizationFeatureKey, OrganizationSettingsSnapshot } from "./organization-settings-contract";

export async function getOrganizationSettings(): Promise<OrganizationSettingsSnapshot> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_organization_settings");
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("ORGANIZATION_SETTINGS_NOT_FOUND");
  return data as unknown as OrganizationSettingsSnapshot;
}

/**
 * 运行期开关统一从数据库求值。未知键、缺行、未到生效时间都由 RPC 收敛为 false；
 * React cache 保证同一请求里导航、页面门禁和数据层不会重复查库。
 */
export const isFeatureEnabled = cache(async (flagKey: OrganizationFeatureKey): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_feature_enabled", { p_flag_key: flagKey });
  if (error) return false;
  return data === true;
});

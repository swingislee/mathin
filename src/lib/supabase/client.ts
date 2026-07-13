import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseConfig } from "./config";
import type { Database } from "@/lib/database.types";

export function createClient() {
  const { url, key } = getSupabaseConfig();
  return createBrowserClient<Database>(url, key);
}

/**
 * 独占 Realtime socket 的浏览器客户端。常规数据请求应继续用 createClient；仅用于
 * 同一页面上需要相同 topic、但生命周期与配置必须隔离的 T1 WebRTC 信令频道。
 */
export function createIsolatedRealtimeClient() {
  const { url, key } = getSupabaseConfig();
  return createBrowserClient<Database>(url, key, { isSingleton: false });
}

import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * service role 客户端：绕过 RLS，仅用于服务端经校验后的受信写入
 * （如游戏开局/成绩落库，docs/plan/03-3.2）。绝不能被客户端代码 import。
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY");
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

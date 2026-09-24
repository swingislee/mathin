import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWechatConfig } from "./config";

export async function checkWechatRateLimit(purpose: "start" | "password", userId?: string) {
  const config = getWechatConfig();
  // 部署代理覆盖 X-Real-IP，应用端口只接受该代理；不相信客户端可追加的 X-Forwarded-For。
  const ip = userId ? "" : (await headers()).get("x-real-ip") ?? "";
  const secret = purpose === "password" ? process.env.SUPABASE_SECRET_KEY : config?.clientSecret;
  if (!secret || (!userId && !isIP(ip))) throw new Error("unavailable");
  const key = createHmac("sha256", secret).update(`${purpose}:${userId ?? ip}`).digest("hex");
  const { data, error } = await createAdminClient().rpc("allow_wechat_oauth_attempt", { p_key_hash: key, p_limit: purpose === "start" ? 20 : 8 });
  if (error) throw new Error("unavailable");
  if (!data) throw new Error("rateLimited");
}

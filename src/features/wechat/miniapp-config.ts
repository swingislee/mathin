import "server-only";
import { getSupabaseConfig } from "@/lib/supabase/config";
import type { WechatConfig } from "./config";

export type MiniappWechatConfig = Pick<WechatConfig, "appId" | "appSecret" | "namespace" | "clientId" | "clientSecret" | "siteOrigin" | "authCallbackUrl" | "phoneLinking"> & {
  authOrigin: string;
  completionUrl: string;
};

function origin(value: string | undefined) {
  const url = new URL(value ?? "");
  // 小程序不使用浏览器 Cookie；本机开发仍可使用已登记的局域网 HTTP 入口。
  const localHttp = process.env.NODE_ENV !== "production" && url.protocol === "http:"
    && ["127.0.0.1", "localhost", "192.168.5.213"].includes(url.hostname);
  if ((!localHttp && url.protocol !== "https:") || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash) throw new Error("unavailable");
  return url.origin;
}

export function getMiniappWechatConfig(): MiniappWechatConfig | null {
  if (process.env.WECHAT_MINIPROGRAM_ENABLED !== "true"
    || process.env.WECHAT_AUTH_COMPATIBILITY_VERIFIED !== "true" || !process.env.SUPABASE_SECRET_KEY) return null;
  try {
    const appId = process.env.WECHAT_MINIPROGRAM_APP_ID;
    const appSecret = process.env.WECHAT_MINIPROGRAM_APP_SECRET;
    const namespace = process.env.WECHAT_OPEN_PLATFORM_NAMESPACE;
    const clientSecret = process.env.WECHAT_BROKER_CLIENT_SECRET;
    if (!appId || !/^wx[a-f0-9]{16}$/i.test(appId) || !appSecret || appSecret.length > 2048
      || !namespace || !/^[a-z0-9-]{1,40}$/.test(namespace) || !clientSecret || clientSecret.length < 32) return null;
    const siteOrigin = origin(process.env.WECHAT_SITE_ORIGIN);
    const authOrigin = origin(process.env.WECHAT_SUPABASE_PUBLIC_ORIGIN);
    if (origin(getSupabaseConfig().url) !== authOrigin) return null;
    return { appId, appSecret, namespace, clientSecret, siteOrigin, authOrigin,
      clientId: "mathin-wechat", authCallbackUrl: `${authOrigin}/auth/v1/callback`,
      completionUrl: `${siteOrigin}/api/v1/parent/auth/wechat`,
      phoneLinking: process.env.WECHAT_PHONE_LINKING_VERIFIED === "true" };
  } catch { return null; }
}

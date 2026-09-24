import "server-only";

export type WechatConfig = {
  appId: string;
  appSecret: string;
  namespace: string;
  siteOrigin: string;
  callbackUrl: string;
  authCallbackUrl: string;
  clientId: string;
  clientSecret: string;
  phoneLinking: boolean;
};

function httpsOrigin(value: string | undefined): string {
  const url = new URL(value ?? "");
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("unavailable");
  }
  return url.origin;
}

/** 微信回调固定外部 HTTPS 源；局域网开发入口继续用于不依赖真实扫码的验收。 */
export function getWechatConfig(): WechatConfig | null {
  if (process.env.WECHAT_OAUTH_ENABLED !== "true") return null;
  try {
    const appId = process.env.WECHAT_WEB_APP_ID;
    const appSecret = process.env.WECHAT_WEB_APP_SECRET;
    const clientSecret = process.env.WECHAT_BROKER_CLIENT_SECRET;
    const namespace = process.env.WECHAT_OPEN_PLATFORM_NAMESPACE;
    if (!appId || !appSecret || !clientSecret || clientSecret.length < 32 || !namespace
      || !/^[a-z0-9-]{1,40}$/.test(namespace)) return null;
    const siteOrigin = httpsOrigin(process.env.WECHAT_SITE_ORIGIN);
    const authOrigin = httpsOrigin(process.env.WECHAT_SUPABASE_PUBLIC_ORIGIN);
    // Auth 升级与 provider 联调通过后才启用入口；避免仅凭 AppID 就显示可用。
    if (process.env.WECHAT_AUTH_COMPATIBILITY_VERIFIED !== "true") return null;
    return {
      appId, appSecret, namespace, clientSecret, siteOrigin,
      clientId: "mathin-wechat",
      callbackUrl: `${siteOrigin}/zh/auth/wechat/callback`,
      authCallbackUrl: `${authOrigin}/auth/v1/callback`,
      phoneLinking: process.env.WECHAT_PHONE_LINKING_VERIFIED === "true",
    };
  } catch { return null; }
}

export function requireWechatConfig(): WechatConfig {
  const config = getWechatConfig();
  if (!config) throw new Error("unavailable");
  return config;
}

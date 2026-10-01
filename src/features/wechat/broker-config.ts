import "server-only";
import { requireWechatConfig } from "./config";
import { getMiniappWechatConfig } from "./miniapp-config";

/** 两种官方身份兑换共用原生 Auth broker；网站扫码入口继续由网站开关单独控制。 */
export function requireWechatTokenConfig() {
  try { return requireWechatConfig(); }
  catch {
    const config = getMiniappWechatConfig();
    if (!config) throw new Error("unavailable");
    return config;
  }
}

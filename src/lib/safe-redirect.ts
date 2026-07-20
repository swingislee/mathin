/**
 * 站内 returnTo/next 白名单：必须是当前 locale 前缀的同源路径，拒绝协议相对地址（`//`）
 * 绕过。不合法时回落到调用方提供的 fallback。P4I §20："returnTo 只接受站内白名单"。
 */
export function resolveSafeReturnTo(raw: string | null | undefined, locale: string, fallback: string): string {
  const path = typeof raw === "string" ? raw : "";
  return path.startsWith(`/${locale}/`) && !path.startsWith("//") ? path : fallback;
}

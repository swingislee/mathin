import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { resolveSafeReturnTo } from "@/lib/safe-redirect";
import { authReturnOrigin } from "@/lib/auth-return-origin";
import { privateRedirect } from "@/features/wechat/broker";
import { wechatIdentitySchema } from "@/features/wechat/contract";
import { getMiniappWechatConfig } from "@/features/wechat/miniapp-config";
import { exchangeMiniappIdentitySession, revokeMiniappSession } from "@/features/wechat/miniapp-session";
import { readTicket } from "@/features/wechat/store";

const ticketSchema = z.object({ userId: z.string().uuid(), identity: wechatIdentitySchema, next: z.string().max(500) });

/** A page opened from the Mini Program arrives with a one-time ticket; it becomes this browser's own session and leaves the address. */
export async function GET(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const locale = (await params).locale === "en" ? "en" : "zh";
  const url = new URL(request.url), origin = authReturnOrigin(request);
  const ticket = await readTicket("miniapp_web", url.searchParams.get("ticket") ?? undefined, "miniapp-web", ticketSchema, true).catch(() => null);
  const next = resolveSafeReturnTo(ticket?.next, locale, `/${locale}/family`);
  const config = getMiniappWechatConfig();
  if (!ticket || !config) return privateRedirect(new URL(`/${locale}/login?next=${encodeURIComponent(next)}`, origin));
  try {
    // A separate session for the web view, so the Mini Program and the page never share a refresh token.
    const session = await exchangeMiniappIdentitySession(config, ticket.identity, ticket.userId);
    const supabase = await createClient();
    const { data, error } = await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    if (error || data.user?.id !== ticket.userId) {
      await revokeMiniappSession(session.access_token).catch(() => undefined);
      throw new Error("failed");
    }
    return privateRedirect(new URL(next, origin));
  } catch {
    return privateRedirect(new URL(`/${locale}/login?next=${encodeURIComponent(next)}`, origin));
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveSafeReturnTo } from "@/lib/safe-redirect";
import { privateRedirect, takeWechatCompletion } from "@/features/wechat/broker";
import { WECHAT_FLOW_COOKIE, WECHAT_GUEST_COOKIE, WECHAT_PROVIDER } from "@/features/wechat/contract";
import { assertAccountActive, saveWechatSnapshot } from "@/features/wechat/store";
import { assertWechatFlowSession, setWechatCookie } from "@/features/wechat/session";
import { authReturnOrigin } from "@/lib/auth-return-origin";

export async function GET(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = rawLocale === "en" ? "en" : "zh";
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = resolveSafeReturnTo(url.searchParams.get("next"), locale, `/${locale}/dashboard`);
  const origin = authReturnOrigin(request);
  const isWechat = url.searchParams.get("wechat") === "1";
  const fail = () => privateRedirect(new URL(`/${locale}/login?${isWechat ? "wechatError=failed" : "error=callback"}`, origin));
  if (!code || url.searchParams.has("error") || code.length > 2048) return fail();
  try {
    const completion = isWechat ? await takeWechatCompletion() : null;
    if (isWechat && !completion) return fail();
    if (completion) await assertWechatFlowSession(completion.flow);
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) return fail();
    if (completion) {
      const { data: verified, error: verificationError } = await supabase.auth.getUser();
      if (verificationError || verified.user?.id !== completion.userId
        || !verified.user.identities?.some((identity) => identity.provider === WECHAT_PROVIDER && identity.identity_data?.sub === completion.identity.subject)) {
        await supabase.auth.signOut({ scope: "local" });
        return fail();
      }
      await assertAccountActive(completion.userId);
      await saveWechatSnapshot(completion.userId, completion.identity);
      await setWechatCookie(WECHAT_FLOW_COOKIE, "", 0);
      await setWechatCookie(WECHAT_GUEST_COOKIE, "", 0);
      const destination = completion.flow.mode === "link"
        ? `/${completion.flow.locale}/dashboard/account-security?section=identities&wechatResult=linked`
        : resolveSafeReturnTo(completion.flow.next, completion.flow.locale, `/${completion.flow.locale}/dashboard`);
      return privateRedirect(new URL(destination, origin));
    }
    return NextResponse.redirect(new URL(next, origin), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch { return fail(); }
}

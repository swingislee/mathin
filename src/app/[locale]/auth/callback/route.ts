import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveSafeReturnTo } from "@/lib/safe-redirect";

export async function GET(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = resolveSafeReturnTo(url.searchParams.get("next"), locale, `/${locale}/dashboard`);
  if (code) { const supabase = await createClient(); await supabase.auth.exchangeCodeForSession(code); }
  return NextResponse.redirect(new URL(next, request.url));
}

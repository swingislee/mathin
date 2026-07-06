import createMiddleware from "next-intl/middleware";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";

const intlMiddleware = createMiddleware(routing);
const protectedPattern = /^\/(zh|en)\/(dashboard|classroom|notebook|whiteboard)(?:\/|$)/;

export async function proxy(request: NextRequest) {
  let response = intlMiddleware(request);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        const next = intlMiddleware(request);
        items.forEach(({ name, value, options }) => next.cookies.set(name, value, options));
        response = next;
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  const match = request.nextUrl.pathname.match(protectedPattern);
  if (!user && match) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = `/${match[1]}/login`;
    loginUrl.search = "";
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return response;
}

// embed 为无 locale 前缀的纯净嵌入路由（docs/plan/03-§6），不经过 intl/auth 中间件
export const config = { matcher: ["/((?!api|embed|_next|_vercel|.*\\..*).*)"] };

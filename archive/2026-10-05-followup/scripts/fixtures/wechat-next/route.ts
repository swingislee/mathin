// 仅复制到 .tmp 下独立启动的 Next 应用，不注册到产品路由。
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { beginWechatFlow, currentWechatAuthContext, verifyWechatLinkPassword } from "@/features/wechat/session";
import { readGuest } from "@/features/wechat/store";

export async function GET() {
  return NextResponse.json({ ready: true });
}

export async function POST(request: Request) {
  if (request.headers.get("x-mathin-fixture") !== process.env.MATHIN_FIXTURE_KEY) {
    return NextResponse.json({ error: "fixture_required" }, { status: 403 });
  }
  try {
    const input = await request.json();
    const client = await createClient();
    if (input.action === "password") {
      const { data, error } = await client.auth.signInWithPassword(input.credentials);
      if (error || !data.user) throw new Error("password_failed");
      return NextResponse.json({ id: data.user.id });
    }
    if (input.action === "guest") return NextResponse.json({ guest: !!(await readGuest()) });
    const context = await currentWechatAuthContext();
    if (input.action === "context") return NextResponse.json({ id: context.userId, session: !!context.sessionId });
    if (input.action !== "start") throw new Error("action_failed");
    if (input.mode === "link") {
      if (!context.user) throw new Error("session_required");
      await verifyWechatLinkPassword(context.user.id, input.identifier, input.password);
    }
    const url = await beginWechatFlow({
      mode: input.mode, locale: input.locale, next: input.next,
      userId: context.userId, sessionId: context.sessionId,
    });
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: "fixture_action_failed" }, { status: 400 });
  }
}

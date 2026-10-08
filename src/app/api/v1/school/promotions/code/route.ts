import { z } from "zod";
import { authorizedClient } from "@/features/school/actions/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMiniappWechatConfig } from "@/features/wechat/miniapp-config";
import { miniappPromotionCode } from "@/features/wechat/miniapp-phone";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request) {
  try {
    await authorizedClient("registration.invite.manage");
    const query = z.object({ scene: z.string().regex(/^[a-f0-9]{24}$/), environment: z.enum(["release", "trial", "develop"]) })
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    const { data, error } = await createAdminClient().from("miniapp_forms").select("slug").eq("slug", query.scene).eq("purpose", "promotion").eq("enabled", true).maybeSingle();
    if (error || !data) return Response.json({ code: "NOT_FOUND" }, { status: 404, headers });
    const config = getMiniappWechatConfig();
    if (!config) return new Response("微信小程序服务尚未配置。", { status: 503, headers });
    const code = await miniappPromotionCode(config, query.scene, query.environment);
    return new Response(code.bytes, { headers: { ...headers, "Content-Type": code.mime,
      "Content-Disposition": `inline; filename="wechat-${query.scene}.${code.mime === "image/png" ? "png" : "jpg"}"` } });
  } catch (error) {
    const denied = error instanceof Error && ["UNAUTHENTICATED", "FORBIDDEN"].includes(error.message);
    return new Response(denied ? "没有访问权限。" : "小程序码暂时无法生成，请确认微信配置及所选版本已发布后重试。", { status: denied ? 403 : 503, headers });
  }
}

import { z } from "zod";
import { authorizedClient } from "@/features/school/actions/guards";
import { getMiniappWechatConfig } from "@/features/wechat/miniapp-config";
import { miniappGuardianCode } from "@/features/wechat/miniapp-phone";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request) {
  try {
    const { supabase } = await authorizedClient("student.edit");
    const query = z.object({ id: z.string().uuid(), environment: z.enum(["release", "trial", "develop"]) })
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    const { data, error } = await supabase.from("guardian_bind_invitations").select("code")
      .eq("id", query.id).is("used_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error || !data || data.code.length !== 32) return Response.json({ code: "NOT_FOUND" }, { status: 404, headers });
    const config = getMiniappWechatConfig();
    if (!config) return Response.json({ code: "UNAVAILABLE" }, { status: 503, headers });
    const code = await miniappGuardianCode(config, data.code, query.environment);
    return new Response(code.bytes, { headers: { ...headers, "Content-Type": code.mime,
      "Content-Disposition": 'inline; filename="guardian-invitation.png"' } });
  } catch (error) {
    const denied = error instanceof Error && ["UNAUTHENTICATED", "FORBIDDEN"].includes(error.message);
    return Response.json({ code: denied ? "FORBIDDEN" : "UNAVAILABLE" }, { status: denied ? 403 : 503, headers });
  }
}

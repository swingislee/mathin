import { timingSafeEqual } from "node:crypto";
import { dispatchExperienceNotifications } from "@/features/participant-portal/notification-server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const expected = process.env.MATHIN_MINIAPP_NOTIFICATION_WORKER_SECRET, token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!expected || expected.length < 32 || !token || Buffer.byteLength(token) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return new Response(null, { status: 403 });
  try { return Response.json(await dispatchExperienceNotifications(), { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ code: "UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}

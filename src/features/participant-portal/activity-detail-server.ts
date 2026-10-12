import "server-only";
import { createClient as publicClient } from "@supabase/supabase-js";
import { createClient as staffClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { courseOfferSchema, registrationIdSchema } from "@/features/parent-portal/course-contract";
import { requireResult, response, PortalError } from "@/features/parent-portal/server";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { activityImagePath, activityPageSchema } from "@/features/school/miniapp-activity-page/contract";
import { activityOffers } from "./projection";
import { z } from "zod";

function anonymousClient() {
  const { url, key } = getSupabaseConfig();
  return publicClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function activityDetailGet(request: Request) {
  const id = registrationIdSchema.parse(new URL(request.url).searchParams.get("id"));
  const db = anonymousClient();
  const value = requireResult(await (db.rpc as unknown as RegistrationRpc)("miniapp_activity_detail", { p_target_id: id }));
  if (!value) throw new PortalError("NOT_FOUND");
  const parsed = z.object({ offer: courseOfferSchema, page: activityPageSchema.nullable() }).safeParse(value);
  if (!parsed.success) throw new PortalError("UNAVAILABLE");
  const offer = activityOffers([parsed.data.offer])[0];
  if (!offer) throw new PortalError("NOT_FOUND");
  return response({ offer, page: parsed.data.page });
}
export async function activityImageGet(request: Request) {
  const params = new URL(request.url).searchParams, path = params.get("path") || "";
  if (!activityImagePath.test(path)) throw new PortalError("NOT_FOUND");
  // Staff preview is cookie-authenticated; public requests always use anonymous
  // Storage policies, which allow only images in currently visible publications.
  const db = params.get("preview") === "1" ? await staffClient() : anonymousClient();
  const result = await db.storage.from("miniapp-activity-images").download(path);
  if (result.error || !result.data) throw new PortalError("NOT_FOUND");
  const type = path.endsWith(".png") ? "image/png" : path.endsWith(".jpg") ? "image/jpeg" : "image/webp";
  return new Response(result.data, { headers: { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
}

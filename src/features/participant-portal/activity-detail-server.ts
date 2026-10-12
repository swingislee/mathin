import "server-only";
import { createClient as publicClient } from "@supabase/supabase-js";
import { createClient as staffClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { courseOfferSchema, registrationIdSchema } from "@/features/parent-portal/course-contract";
import { requireResult, response, PortalError } from "@/features/parent-portal/server";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { activityImagePath, activityPageSchema, activityListingSchema } from "@/features/school/miniapp-activity-page/contract";
import { activityOffers } from "./projection";
import { publishedImageResponse } from "./published-image";
import type { ActivityOffer } from "../../../contracts/participant-api/portal";
import { z } from "zod";

function anonymousClient() {
  const { url, key } = getSupabaseConfig();
  return publicClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function registrationFacts(offer: ActivityOffer): NonNullable<ActivityOffer["registration"]> {
  // Published participant activities currently use the community, staff-confirmed workflow.
  return { fee: "free", confirmation: "staff", reservesPlace: false, canApply: Date.parse(offer.bookingClosesAt) > Date.now() };
}
export async function activityCatalogGet() {
  const db = anonymousClient();
  const value = requireResult(await (db.rpc as unknown as RegistrationRpc)("miniapp_activity_catalog_presentation"));
  const parsed = courseOfferSchema.extend({ listing: activityListingSchema }).array().safeParse(value);
  if (!parsed.success) throw new PortalError("UNAVAILABLE");
  return response(parsed.data.flatMap(row => activityOffers([row]).map(offer => ({ ...offer, listing: row.listing, registration: registrationFacts(offer) }))));
}
export async function activityDetailGet(request: Request) {
  const id = registrationIdSchema.parse(new URL(request.url).searchParams.get("id"));
  const db = anonymousClient();
  const value = requireResult(await (db.rpc as unknown as RegistrationRpc)("miniapp_activity_detail", { p_target_id: id }));
  if (!value) throw new PortalError("NOT_FOUND");
  const parsed = z.object({ offer: courseOfferSchema, page: activityPageSchema.nullable(), pageRevision: z.number().int().nonnegative().default(0) }).safeParse(value);
  if (!parsed.success) throw new PortalError("UNAVAILABLE");
  const offer = activityOffers([parsed.data.offer])[0];
  if (!offer) throw new PortalError("NOT_FOUND");
  return response({ offer: { ...offer, registration: registrationFacts(offer) }, page: parsed.data.page, pageRevision: parsed.data.pageRevision });
}
export async function activityImageGet(request: Request) {
  const params = new URL(request.url).searchParams, path = params.get("path") || "";
  if (!activityImagePath.test(path)) throw new PortalError("NOT_FOUND");
  // Staff preview is cookie-authenticated; public requests always use anonymous
  // Storage policies, which allow only images in currently visible publications.
  const db = params.get("preview") === "1" ? await staffClient() : anonymousClient();
  const preview = params.get("preview") === "1";
  const result = await (db.rpc as unknown as RegistrationRpc)("miniapp_activity_image_path", {
    p_path: path, p_thumbnail: params.get("size") === "thumb", p_preview: preview });
  if (result.error || typeof result.data !== "string" || !result.data) throw new PortalError("NOT_FOUND");
  return publishedImageResponse(request, db, "miniapp-activity-images", result.data, async () => true, preview);
}

import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createClient as staffClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { requireResult, PortalError } from "@/features/parent-portal/server";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { defaultMiniappSettings, type MiniappSettingsPublication } from "../../../contracts/participant-api/miniapp-settings";
import { miniappAssetPath, miniappSettingsSchema } from "@/features/school/miniapp-settings/contract";
import { publishedImageResponse } from "./published-image";

export function miniappPublicClient() {
  const { url, key } = getSupabaseConfig();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function readPublishedSettings(): Promise<MiniappSettingsPublication> {
  const db = miniappPublicClient();
  const data = requireResult(await (db.rpc as unknown as RegistrationRpc)("miniapp_settings_publication", {})) as MiniappSettingsPublication;
  return { revision: data.revision, publishedAt: data.publishedAt, config: data.config ? miniappSettingsSchema.parse(data.config) : defaultMiniappSettings() };
}
export async function miniappSettingsGet(request: Request) {
  const result = await readPublishedSettings(), url = new URL(request.url), tag = `"miniapp-${result.revision}"`;
  const headers = { "Cache-Control": "public, no-cache", ETag: tag, "X-Content-Type-Options": "nosniff" };
  if (request.headers.get("if-none-match") === tag) return new Response(null, { status: 304, headers });
  return Response.json({ ...result, config: url.searchParams.get("revision") === String(result.revision) ? null : result.config }, { headers });
}
export async function miniappContentImageGet(request: Request) {
  const params = new URL(request.url).searchParams, base = params.get("path") || "", preview = params.get("preview") === "1";
  if (!miniappAssetPath.test(base)) throw new PortalError("NOT_FOUND");
  const db = preview ? await staffClient() : miniappPublicClient();
  const path = params.get("size") === "thumb" ? base.replace(/\.webp$/, ".thumb.webp") : base;
  return publishedImageResponse(request, db, "miniapp-content-images", path, async () => {
    const access = await (db.rpc as unknown as RegistrationRpc)("can_access_miniapp_content_image", { p_path: path, p_write: preview });
    return !access.error && access.data === true;
  }, preview);
}

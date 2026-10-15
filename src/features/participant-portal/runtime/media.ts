import "server-only";
import { createClient as staffClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { PortalError } from "@/features/parent-portal/server";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { miniappPublicClient } from "../settings-server";
import { runtimeMediaPath } from "./spec";

const types: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "video/mp4" };
/** Streams published audio or video with range support, so players can seek and background audio can resume. */
export async function runtimeMediaGet(request: Request) {
  const params = new URL(request.url).searchParams, path = params.get("path") || "", preview = params.get("preview") === "1";
  if (!runtimeMediaPath.test(path)) throw new PortalError("NOT_FOUND");
  const db = preview ? await staffClient() : miniappPublicClient();
  const access = await (db.rpc as unknown as RegistrationRpc)("can_access_miniapp_content_media", { p_path: path, p_write: false });
  if (access.error || access.data !== true) throw new PortalError("NOT_FOUND");
  const signed = await createAdminClient().storage.from("miniapp-content-media").createSignedUrl(path, 300);
  if (signed.error || !signed.data?.signedUrl) throw new PortalError("NOT_FOUND");
  // The signed address may use the public Auth origin; fetch it through the configured server origin.
  const source = new URL(signed.data.signedUrl);
  const target = new URL(source.pathname + source.search, getSupabaseConfig().url);
  const range = request.headers.get("range");
  const result = await fetch(target, { headers: range ? { Range: range } : {}, cache: "no-store" });
  if (!result.ok || !result.body) throw new PortalError("NOT_FOUND");
  const headers = new Headers({ "Content-Type": types[path.split(".").pop() || ""] || "application/octet-stream", "Accept-Ranges": "bytes",
    "Cache-Control": preview ? "private, no-store" : "public, max-age=300", "X-Content-Type-Options": "nosniff" });
  for (const key of ["content-length", "content-range"]) { const value = result.headers.get(key); if (value) headers.set(key, value); }
  return new Response(result.body, { status: result.status, headers });
}

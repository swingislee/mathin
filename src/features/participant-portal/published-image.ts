import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PortalError } from "@/features/parent-portal/server";

const images = new Map<string, { bytes: Uint8Array; type: string; at: number }>();
let cachedBytes = 0;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
/** Visibility is checked on every request, including conditional cache hits and staff previews. */
export async function publishedImageResponse(request: Request, db: SupabaseClient, bucket: string, path: string,
  authorize: () => Promise<boolean>, preview: boolean) {
  if (!await authorize()) throw new PortalError("NOT_FOUND");
  const tag = '"' + createHash("sha256").update(`${bucket}/${path}`).digest("hex").slice(0, 32) + '"';
  const headers = new Headers({ "X-Content-Type-Options": "nosniff", "Cache-Control": preview ? "private, no-store" : "private, no-cache", "Vary": "Cookie" });
  if (!preview) {
    headers.set("ETag", tag);
    if (request.headers.get("if-none-match")?.split(",").map(v => v.trim()).includes(tag)) return new Response(null, { status: 304, headers });
  }
  const key = `${bucket}/${path}`, saved = images.get(key);
  if (saved && Date.now() - saved.at > 5 * 60_000) { images.delete(key); cachedBytes -= saved.bytes.byteLength; }
  let image = images.get(key);
  if (!image) {
    const result = await db.storage.from(bucket).download(path);
    if (result.error || !result.data) throw new PortalError("NOT_FOUND");
    const bytes = new Uint8Array(await result.data.arrayBuffer());
    image = { bytes, type: path.endsWith(".png") ? "image/png" : path.endsWith(".jpg") ? "image/jpeg" : "image/webp", at: Date.now() };
    if (bytes.byteLength <= 5 * 1024 * 1024) {
      while (images.size && cachedBytes + bytes.byteLength > MAX_CACHE_BYTES) {
        const oldest = images.keys().next().value!; cachedBytes -= images.get(oldest)!.bytes.byteLength; images.delete(oldest);
      }
      images.set(key, image); cachedBytes += bytes.byteLength;
    }
  }
  headers.set("Content-Type", image.type);
  headers.set("Content-Length", String(image.bytes.byteLength));
  return new Response(new Uint8Array(image.bytes), { headers });
}

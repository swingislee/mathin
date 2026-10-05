import { getSupabaseConfig } from "@/lib/supabase/config";
import { failure, PortalError } from "@/features/parent-portal/server";
export async function GET(request: Request) {
  try {
    const path = new URL(request.url).searchParams.get("path") || "";
    if (!/^-?\d{1,2}\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(path)) throw new PortalError("NOT_FOUND");
    const { url } = getSupabaseConfig();
    const result = await fetch(`${url}/storage/v1/object/public/parent-advisor-qrcodes/${path}`, { cache: "no-store" });
    if (!result.ok) throw new PortalError(result.status === 404 ? "NOT_FOUND" : "UNAVAILABLE");
    const bytes = await result.arrayBuffer();
    if (bytes.byteLength > 1048576) throw new PortalError("UNAVAILABLE");
    const type = path.endsWith(".png") ? "image/png" : path.endsWith(".jpg") ? "image/jpeg" : "image/webp";
    return new Response(bytes, { headers: { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=3600" } });
  } catch (error) { return failure(error); }
}

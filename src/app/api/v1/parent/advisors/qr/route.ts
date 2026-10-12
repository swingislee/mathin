import { createClient as staffClient } from "@/lib/supabase/server";
import { failure, PortalError } from "@/features/parent-portal/server";
import { miniappContentImageGet, miniappPublicClient } from "@/features/participant-portal/settings-server";
import { publishedImageResponse } from "@/features/participant-portal/published-image";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { miniappAssetPath } from "@/features/school/miniapp-settings/contract";
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams, path = query.get("path") || "", preview = query.get("preview") === "1";
    if (miniappAssetPath.test(path)) return await miniappContentImageGet(request);
    if (!/^-?\d{1,2}\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(path)) throw new PortalError("NOT_FOUND");
    const db = preview ? await staffClient() : miniappPublicClient();
    return await publishedImageResponse(request, db, "parent-advisor-qrcodes", path, async () => {
      const r = await (db.rpc as unknown as RegistrationRpc)("can_access_miniapp_advisor_qr", { p_path: path, p_preview: preview });
      return !r.error && r.data === true;
    }, preview);
  } catch (error) { return failure(error); }
}

"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const sessionIdSchema = z.uuid();
const SIGNED_URL_TTL_SECONDS = 6 * 60 * 60;

export interface SessionAssetUrl {
  objectHash: string;
  signedUrl: string;
}

/**
 * 为候课预载批量签发本课次冻结对象的临时 URL。
 *
 * `list_session_resolved_assets` 在数据库内强制校验当前用户确为教室成员；这里仅在
 * 成员范围已经收窄后使用 service key 签名。学生从不直接读取 cw-objects 桶。
 */
export async function getSessionAssetUrls(sessionId: string): Promise<SessionAssetUrl[]> {
  const parsed = sessionIdSchema.safeParse(sessionId);
  if (!parsed.success) throw new Error("VALIDATION");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");

  const { data: assets, error: assetsError } = await supabase
    .rpc("list_session_resolved_assets", { p_session_id: parsed.data })
    .returns<Array<{ object_hash: string; storage_path: string; kind: string }>>();
  if (assetsError) throw new Error(assetsError.message);
  if (!assets?.length) return [];

  const admin = createAdminClient();
  const uniquePaths = [...new Set(assets.map((asset) => asset.storage_path))];
  const { data: signed, error: signingError } = await admin.storage
    .from("cw-objects")
    .createSignedUrls(uniquePaths, SIGNED_URL_TTL_SECONDS);
  if (signingError) throw new Error(signingError.message);

  const urlsByPath = new Map((signed ?? []).map((item) => [item.path, item.signedUrl]));
  return assets.map((asset) => {
    const signedUrl = urlsByPath.get(asset.storage_path);
    if (!signedUrl) throw new Error("SIGNED_URL_MISSING");
    return { objectHash: asset.object_hash, signedUrl };
  });
}

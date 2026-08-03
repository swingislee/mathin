"use server";

import { z } from "zod";
import { buildH5EntryUrl, type ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import { parseCoursewareDoc, type CoursewareDoc } from "@/features/courseware-doc/document";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

const sessionIdSchema = z.uuid();
const SIGNED_URL_TTL_SECONDS = 6 * 60 * 60;

export interface SessionAssetUrl {
  objectHash: string;
  signedUrl: string;
}

const sessionDocBindingSchema = z.object({
  bindingKey: z.string().min(1),
  objectHash: z.string().regex(/^[0-9a-f]{64}$/),
  kind: z.string().min(1),
  launchQuery: z
    .object({
      query: z.record(z.string(), z.array(z.string())),
      coursewareIdParam: z.string().nullable(),
    })
    .nullable(),
});

export type SessionDocBinding = z.infer<typeof sessionDocBindingSchema>;

export interface SessionPageDoc {
  pageDocId: string;
  pageNo: number;
  doc: CoursewareDoc;
  bindings: SessionDocBinding[];
}

const h5ManifestSchema = z.object({ entryPath: z.string().min(1) });

/**
 * Resolve H5 entry bindings for server-rendered previews. H5 packages live in
 * the public content-addressed bucket and must use the app shim so HTML keeps
 * its MIME type, relative assets work, and launch query parameters survive.
 */
export async function getSessionH5BindingUrls(pages: readonly SessionPageDoc[]): Promise<ResolvedBindingUrls> {
  const packageHashes = [...new Set(pages.flatMap((page) =>
    page.bindings.filter((binding) => binding.kind === "h5").map((binding) => binding.objectHash)))];
  if (packageHashes.length === 0) return {};

  const base = getSupabaseConfig().url.replace(/\/$/, "");
  const entries = await Promise.all(packageHashes.map(async (packageHash) => {
    const response = await fetch(
      `${base}/storage/v1/object/public/cw-h5/packages/${packageHash}/__mathin_manifest.json`,
      { cache: "force-cache" },
    );
    if (!response.ok) return null;
    const manifest = h5ManifestSchema.safeParse(await response.json());
    return manifest.success ? [packageHash, manifest.data.entryPath] as const : null;
  }));
  const entryPathByHash = new Map(entries.filter((entry): entry is readonly [string, string] => entry !== null));
  const urls: Record<string, string> = {};
  for (const page of pages) {
    for (const binding of page.bindings) {
      if (binding.kind !== "h5") continue;
      const entryPath = entryPathByHash.get(binding.objectHash);
      if (entryPath) {
        urls[binding.bindingKey] = buildH5EntryUrl(binding.objectHash, entryPath, binding.launchQuery);
      }
    }
  }
  return urls;
}

/**
 * 课堂取页 doc(P6-5,D4):get_session_page_docs 在数据库内校验教室成员,
 * 冻结课次用冻结 pin 的 release,未冻结(候课/试讲)回退讲次 current release。
 * 学生/家长不直读 cw_* 表,这是课堂侧唯一的页内容通道。
 */
export async function getSessionPageDocs(sessionId: string): Promise<SessionPageDoc[]> {
  const parsed = sessionIdSchema.safeParse(sessionId);
  if (!parsed.success) throw new Error("VALIDATION");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");

  const { data, error } = await supabase
    .rpc("get_session_page_docs", { p_session_id: parsed.data })
    .returns<Array<{ page_doc_id: string; page_no: number; doc: unknown; bindings: unknown }>>();
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    pageDocId: row.page_doc_id,
    pageNo: row.page_no,
    doc: parseCoursewareDoc(row.doc),
    bindings: z.array(sessionDocBindingSchema).parse(row.bindings),
  }));
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

// 课堂 doc 页预载管道（P6-5，doc 16 §3 D3/D4）：
// - 页 doc 束经 getSessionPageDocs 取回并存 IndexedDB（离线重进课兜底）；
// - 非 H5 对象经批签 signed URL 下载为 blob 入 IndexedDB（key `cw:<objectHash>`），
//   渲染用 objectURL——离线课全靠这层；
// - H5 包无法 blob 预载（多文件），只做 HTTP 缓存预热（加速在线首开，
//   不改变候课单黄灯语义）；入口 URL 由公开桶 manifest 的 entryPath 拼回。

import { buildH5EntryUrl, type ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { STORE_ASSETS, idbGet, idbPut } from "../sync/idb";
import { getSessionPageDocs, type SessionPageDoc } from "./session-assets";

const DOCS_BUNDLE_KEY = (sessionId: string) => `cwdocs:${sessionId}`;
const OBJECT_KEY = (objectHash: string) => `cw:${objectHash}`;

export interface H5ManifestFile {
  packagePath: string;
}

export interface H5Manifest {
  entryPath: string;
  files: H5ManifestFile[];
}

/** 取页 doc 束：在线取回后写 IndexedDB；失败（离线）回退上次缓存。 */
export async function loadSessionDocsBundle(sessionId: string): Promise<SessionPageDoc[]> {
  try {
    const pages = await getSessionPageDocs(sessionId);
    await idbPut(STORE_ASSETS, DOCS_BUNDLE_KEY(sessionId), pages).catch(() => undefined);
    return pages;
  } catch (error) {
    const cached = await idbGet<SessionPageDoc[]>(STORE_ASSETS, DOCS_BUNDLE_KEY(sessionId));
    if (cached) return cached;
    throw error;
  }
}

/** 需要 blob 预载的对象 hash（非 H5，跨页去重）。 */
export function collectDocObjectHashes(pages: readonly SessionPageDoc[]): string[] {
  const hashes = new Set<string>();
  for (const page of pages) {
    for (const binding of page.bindings) {
      if (binding.kind !== "h5") hashes.add(binding.objectHash);
    }
  }
  return [...hashes];
}

/** H5 包 hash（跨页去重；同包多关卡靠 launchQuery 区分，包只预热一次）。 */
export function collectH5PackageHashes(pages: readonly SessionPageDoc[]): string[] {
  const hashes = new Set<string>();
  for (const page of pages) {
    for (const binding of page.bindings) {
      if (binding.kind === "h5") hashes.add(binding.objectHash);
    }
  }
  return [...hashes];
}

/** 含 H5 绑定的页数（候课单黄灯文案用，D4：不算进已预载）。 */
export function countH5Pages(pages: readonly SessionPageDoc[]): number {
  return pages.filter((page) => page.bindings.some((binding) => binding.kind === "h5")).length;
}

/**
 * bindingKey → URL 总表：非 H5 用预载 blob 的 objectURL；H5 拼垫片入口 URL
 * （含 launchQuery，漏拼会全开第一关——doc 16 P6-1 发现②）。
 * 解析不到的绑定不入表，DocStage 对缺失 URL 渲染可见的降级块。
 */
export function buildDocBindingUrls(
  pages: readonly SessionPageDoc[],
  urlByObjectHash: ReadonlyMap<string, string>,
  h5EntryPathByHash: ReadonlyMap<string, string>,
): ResolvedBindingUrls {
  const urls: Record<string, string> = {};
  for (const page of pages) {
    for (const binding of page.bindings) {
      if (binding.kind === "h5") {
        const entryPath = h5EntryPathByHash.get(binding.objectHash);
        if (entryPath) urls[binding.bindingKey] = buildH5EntryUrl(binding.objectHash, entryPath, binding.launchQuery);
      } else {
        const url = urlByObjectHash.get(binding.objectHash);
        if (url) urls[binding.bindingKey] = url;
      }
    }
  }
  return urls;
}

/** 对象 blob：IndexedDB 命中直取，未命中经 signed URL 下载并落库。 */
export async function loadObjectBlob(objectHash: string, signedUrl: string | undefined): Promise<Blob> {
  const cached = await idbGet<Blob>(STORE_ASSETS, OBJECT_KEY(objectHash));
  if (cached) return cached;
  if (!signedUrl) throw new Error(`SIGNED_URL_MISSING: ${objectHash}`);
  const response = await fetch(signedUrl);
  if (!response.ok) throw new Error(`OBJECT_FETCH_FAILED: ${objectHash}`);
  const blob = await response.blob();
  await idbPut(STORE_ASSETS, OBJECT_KEY(objectHash), blob).catch(() => undefined);
  return blob;
}

/** 公开桶内包 manifest（mathin-h5-manifest-v1）：入口 + 文件清单，一物两用（D3）。 */
export async function fetchH5Manifest(packageHash: string): Promise<H5Manifest> {
  const base = getSupabaseConfig().url.replace(/\/$/, "");
  const response = await fetch(
    `${base}/storage/v1/object/public/cw-h5/packages/${packageHash}/__mathin_manifest.json`,
  );
  if (!response.ok) throw new Error(`H5_MANIFEST_MISSING: ${packageHash}`);
  const manifest = (await response.json()) as Partial<H5Manifest>;
  if (typeof manifest.entryPath !== "string" || !manifest.entryPath) {
    throw new Error(`H5_MANIFEST_INVALID: ${packageHash}`);
  }
  return { entryPath: manifest.entryPath, files: Array.isArray(manifest.files) ? manifest.files : [] };
}

export function h5ShimFileUrl(packageHash: string, packagePath: string): string {
  const encoded = packagePath.split("/").map(encodeURIComponent).join("/");
  return `/api/cw-h5/packages/${packageHash}/${encoded}`;
}

/**
 * H5 包 HTTP 缓存预热：按 manifest 清单逐文件走垫片路由（暖 308 与最终
 * storage 响应两层缓存）。只是加速，失败静默——不构成离线保障（D4 黄灯）。
 */
export async function preheatH5Package(
  packageHash: string,
  manifest: H5Manifest,
  shouldContinue: () => boolean,
): Promise<void> {
  const CONCURRENCY = 4;
  const queue = [...manifest.files];
  const worker = async () => {
    for (;;) {
      const file = queue.shift();
      if (!file || !shouldContinue()) return;
      try {
        await fetch(h5ShimFileUrl(packageHash, file.packagePath), { cache: "force-cache" });
      } catch {
        // 预热失败不影响黄灯语义
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

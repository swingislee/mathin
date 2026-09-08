import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import { STORE_ASSETS, idbGet, idbPut } from "../sync/idb";
import {
  buildDocBindingUrls,
  collectH5PackageHashes,
  fetchH5Manifest,
  loadObjectBlob,
  loadSessionDocsBundle,
  preheatH5Package,
  prioritizeDocObjectHashes,
  takePrioritizedDocObjectHash,
  takePrioritizedH5PackageHash,
  type H5Manifest,
} from "./doc-preload";
import { getSessionAssetUrls, type SessionPageDoc } from "./session-assets";
import { downloadCoursewareAsset } from "./upload";

export interface SessionAssetPreloadProgress {
  done: number;
  total: number;
  failed: number;
}

interface SessionAssetPreloadOptions {
  sessionId: string;
  loadDocs: boolean;
  mediaPaths: readonly string[];
  activeDocId: () => string | null;
  activeMediaPath: () => string | null;
  signal: AbortSignal;
  isCurrent: () => boolean;
  onDocs: (pages: SessionPageDoc[]) => void;
  onDocUrls: (urls: ResolvedBindingUrls) => void;
  onMediaUrl: (path: string, url: string) => void;
  onObjectUrl: (url: string) => void;
  onProgress: (progress: SessionAssetPreloadProgress) => void;
}

/** 当前页资源优先可用；离线对象继续入库，整包 H5 预热在其后统一限流。 */
export async function preloadSessionAssets(options: SessionAssetPreloadOptions): Promise<void> {
  const current = () => !options.signal.aborted && options.isCurrent();
  const mediaPaths = [...new Set(options.mediaPaths)];
  let docPages: SessionPageDoc[] = [];
  if (options.loadDocs) {
    try { docPages = await loadSessionDocsBundle(options.sessionId); }
    catch { /* 读不到页束时，已有媒体仍可独立加载。 */ }
  }
  if (!current()) return;
  options.onDocs(docPages);
  options.onDocUrls({});

  const objectQueue = prioritizeDocObjectHashes(docPages, options.activeDocId());
  const h5Hashes = collectH5PackageHashes(docPages);
  const objectUrls = new Map<string, string>();
  const h5Entries = new Map<string, string>();
  const manifests = new Map<string, H5Manifest>();
  const progress = { done: 0, total: mediaPaths.length + objectQueue.length, failed: 0 };
  options.onProgress({ ...progress });
  const publishUrls = () => {
    if (current()) options.onDocUrls(buildDocBindingUrls(docPages, objectUrls, h5Entries));
  };
  const mark = (result: "done" | "failed") => {
    if (!current()) return;
    progress[result] += 1;
    options.onProgress({ ...progress });
  };
  const objectUrl = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    options.onObjectUrl(url);
    return url;
  };

  // 缓存命中的当前页直接显示；首次缺失才批签，全课共享同一次签发。
  let signedUrls: Promise<Map<string, string>> | undefined;
  const signedUrl = async (hash: string) => {
    signedUrls ??= getSessionAssetUrls(options.sessionId)
      .then((assets) => new Map(assets.map((asset) => [asset.objectHash, asset.signedUrl])))
      .catch(() => new Map<string, string>());
    return (await signedUrls).get(hash);
  };
  const loadObjects = async () => {
    const queue = objectQueue;
    const worker = async () => {
      while (current()) {
        const hash = takePrioritizedDocObjectHash(queue, docPages, options.activeDocId());
        if (!hash) return;
        try {
          const blob = await loadObjectBlob(hash, () => signedUrl(hash), options.signal);
          if (!current()) return;
          objectUrls.set(hash, objectUrl(blob));
          publishUrls();
          mark("done");
        } catch { mark("failed"); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  };
  const loadMedia = async () => {
    const queue = [...mediaPaths];
    while (current() && queue.length) {
      const active = options.activeMediaPath();
      const index = active ? queue.indexOf(active) : -1;
      const path = queue.splice(index < 0 ? 0 : index, 1)[0];
      try {
        let blob = await idbGet<Blob>(STORE_ASSETS, path);
        if (!current()) return;
        if (!blob) {
          blob = await downloadCoursewareAsset(path);
          await idbPut(STORE_ASSETS, path, blob).catch(() => undefined);
        }
        if (!current()) return;
        options.onMediaUrl(path, objectUrl(blob));
        mark("done");
      } catch { mark("failed"); }
    }
  };
  const loadH5Entries = async () => {
    const queue = [...h5Hashes];
    const worker = async () => {
      while (current()) {
        const hash = takePrioritizedH5PackageHash(queue, docPages, options.activeDocId());
        if (!hash) return;
        try {
          const manifest = await fetchH5Manifest(hash, options.signal);
          if (!current()) return;
          manifests.set(hash, manifest);
          h5Entries.set(hash, manifest.entryPath);
          publishUrls();
        } catch { /* 单个包入口失败保留该页的可见降级。 */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, queue.length) }, worker));
  };

  // 三条读取互不等待：长视频和其他互动包不延迟当前 doc 页。
  await Promise.all([loadObjects(), loadMedia(), loadH5Entries()]);

  // 所有包共用两个正文下载槽；HTTP 预热仍不计入离线就绪进度。
  const warmQueue = h5Hashes.filter((hash) => manifests.has(hash));
  while (current()) {
    const hash = takePrioritizedH5PackageHash(warmQueue, docPages, options.activeDocId());
    if (!hash) return;
    await preheatH5Package(hash, manifests.get(hash)!, current, options.signal);
  }
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import { preloadSessionAssets } from "../courseware/preload-session-assets";
import type { SessionPageDoc } from "../courseware/session-assets";
import type { CoursewarePage } from "../types";

/** 页束与资源读取独立管理，切页只改变队列优先级。 */
export function useSessionAssetPreload(
  sessionId: string,
  hasLecture: boolean,
  pages: readonly CoursewarePage[],
  currentPage: number,
) {
  const mediaPaths = pages.flatMap((page) => page.type === "image" || page.type === "video" ? [page.path] : []);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [preload, setPreload] = useState(() => ({ done: 0, total: new Set(mediaPaths).size, failed: 0 }));
  const [docBundle, setDocBundle] = useState<SessionPageDoc[] | null>(null);
  const [docUrls, setDocUrls] = useState<ResolvedBindingUrls>({});
  const active = pages[currentPage];
  const activeDocId = active?.type === "doc" ? active.docId : null;
  const activeMediaPath = active?.type === "image" || active?.type === "video" ? active.path : null;
  const priority = useRef({ docId: activeDocId, mediaPath: activeMediaPath });
  useEffect(() => {
    priority.current = { docId: activeDocId, mediaPath: activeMediaPath };
  }, [activeDocId, activeMediaPath]);

  // 学生开课补取的冻结页进入预载；板书插页重建数组时复用已有 objectURL。
  const mediaKey = JSON.stringify(mediaPaths);
  const docPageKey = pages.flatMap((page) => page.type === "doc" ? [page.docId] : []).join("|");
  useEffect(() => {
    const urls: string[] = [];
    const controller = new AbortController();
    void preloadSessionAssets({
      sessionId,
      loadDocs: hasLecture || Boolean(docPageKey),
      mediaPaths: JSON.parse(mediaKey) as string[],
      activeDocId: () => priority.current.docId,
      activeMediaPath: () => priority.current.mediaPath,
      signal: controller.signal,
      isCurrent: () => !controller.signal.aborted,
      onDocs: (bundle) => { setAssetUrls({}); setDocBundle(bundle); },
      onDocUrls: setDocUrls,
      onMediaUrl: (path, url) => setAssetUrls((prev) => ({ ...prev, [path]: url })),
      onObjectUrl: (url) => { urls.push(url); },
      onProgress: setPreload,
    });
    return () => {
      controller.abort();
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [docPageKey, hasLecture, mediaKey, sessionId]);

  return { assetUrls, preload, docBundle, docUrls };
}

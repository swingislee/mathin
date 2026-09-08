import type { CoursewareDoc } from "@/features/courseware-doc/document";
import { isCoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import { isSourceRuntimePageDoc } from "@/features/courseware-doc/source-runtime-schema";
import { collectCoursewarePreviewWarmTargets } from "@/features/courseware-preview/preload";
import type { SessionPageDoc } from "../courseware/session-assets";
import type { CoursewarePage } from "../types";

/** 来源页按运行时复用舞台；游戏、组合页和原生互动继续按课堂页面重置。 */
export function classroomDocMountKey(pageId: string, doc: CoursewareDoc | null | undefined): string {
  return doc && isSourceRuntimePageDoc(doc)
    ? `source-runtime:${JSON.stringify([doc.runtime.packageHash, doc.runtime.entryPath])}`
    : `doc:${pageId}`;
}

function docImageUrls(doc: CoursewareDoc, urls: ResolvedBindingUrls): string[] {
  if (isCoursewareCompositionPage(doc)) {
    return [
      ...(doc.source ? docImageUrls(doc.source.doc, urls) : []),
      ...docImageUrls(doc.overlay, urls),
    ];
  }
  return collectCoursewarePreviewWarmTargets(doc, urls)
    .filter((target) => target.kind === "image")
    .map((target) => target.url);
}

/** 按实际课堂页序预热当前页、后续三页和上一页；仅使用已经解析好的图片 URL。 */
export function classroomWarmImageUrls(
  pages: readonly CoursewarePage[],
  currentPage: number,
  docs: readonly SessionPageDoc[] | null,
  bindingUrls: ResolvedBindingUrls,
  assetUrls: Readonly<Record<string, string>>,
): string[] {
  const byId = new Map(docs?.map((entry) => [entry.pageDocId, entry.doc]));
  const urls = new Set<string>();
  for (const index of [currentPage, currentPage + 1, currentPage + 2, currentPage + 3, currentPage - 1]) {
    const page = pages[index];
    if (page?.type === "image" && assetUrls[page.path]) urls.add(assetUrls[page.path]);
    if (page?.type !== "doc") continue;
    const doc = byId.get(page.docId);
    if (doc) for (const url of docImageUrls(doc, bindingUrls)) urls.add(url);
  }
  return [...urls];
}

/** 两个解码槽跟随最新页序，去重正在处理的图片，并释放窗口外的完成记录。 */
export function createClassroomImageWarmup(warm: (url: string) => Promise<void>) {
  let desired = new Set<string>();
  let queue: string[] = [];
  const pending = new Set<string>();
  const completed = new Set<string>();
  let disposed = false;
  const drain = () => {
    while (!disposed && pending.size < 2 && queue.length) {
      const url = queue.shift()!;
      pending.add(url);
      void Promise.resolve().then(() => warm(url)).catch(() => undefined).finally(() => {
        pending.delete(url);
        if (!disposed && desired.has(url)) completed.add(url);
        drain();
      });
    }
  };
  return {
    update(urls: readonly string[]) {
      if (disposed) return;
      desired = new Set(urls);
      for (const url of completed) if (!desired.has(url)) completed.delete(url);
      queue = [...desired].filter((url) => !pending.has(url) && !completed.has(url));
      drain();
    },
    dispose() {
      disposed = true;
      queue = [];
      desired.clear();
      completed.clear();
    },
  };
}

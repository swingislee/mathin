import type { CoursewareDoc } from "@/features/courseware-doc/document";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import { collectBindingKeys, PAGE_DOC_VERSION } from "@/features/courseware-doc/schema";
import { isSourceRuntimePageDoc } from "@/features/courseware-doc/source-runtime-schema";

export interface CoursewarePreviewWarmTarget {
  kind: "image" | "h5";
  url: string;
}

const WARM_TIMEOUT_MS = 2_000;

export function collectCoursewarePreviewWarmTargets(
  doc: CoursewareDoc,
  bindingUrls: ResolvedBindingUrls,
): CoursewarePreviewWarmTarget[] {
  const targets = new Map<string, CoursewarePreviewWarmTarget>();
  if (isSourceRuntimePageDoc(doc)) {
    const assets = doc.payload.format === "aixuexi-viewer-page-v1"
      && doc.payload.data.assets
      && typeof doc.payload.data.assets === "object"
      && !Array.isArray(doc.payload.data.assets)
      ? doc.payload.data.assets as Record<string, unknown>
      : null;
    const resources = assets && Array.isArray(assets.resources) ? assets.resources : [];
    for (const raw of resources) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const resource = raw as Record<string, unknown>;
      const image = resource.kind === "image"
        || resource.kind === "svg"
        || (typeof resource.mime === "string" && resource.mime.startsWith("image/"));
      if (!image) continue;
      const resourceId = resource.resourceRefId;
      if (!Number.isInteger(resourceId)) continue;
      const bindingKey = doc.bindings.resources[String(resourceId)];
      const url = bindingKey ? bindingUrls[bindingKey] : undefined;
      if (url) targets.set(`image:${url}`, { kind: "image", url });
    }
    return [...targets.values()];
  }
  if (doc.docVersion !== PAGE_DOC_VERSION) return [];
  for (const [bindingKey, binding] of collectBindingKeys(doc)) {
    const url = bindingUrls[bindingKey];
    if (!url) continue;
    if (binding.kind === "image" || binding.kind === "svg") {
      targets.set(`image:${url}`, { kind: "image", url });
    } else if (binding.kind === "h5") {
      targets.set(`h5:${url}`, { kind: "h5", url });
    }
  }
  return [...targets.values()];
}

async function warmImage(url: string): Promise<void> {
  if (typeof Image === "undefined") return;
  await new Promise<void>((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, WARM_TIMEOUT_MS);
    image.decoding = "async";
    image.onload = () => {
      if (typeof image.decode !== "function") {
        finish();
        return;
      }
      void image.decode().catch(() => undefined).finally(finish);
    };
    image.onerror = finish;
    image.src = url;
  });
}

async function warmH5Entry(url: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WARM_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "force-cache",
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (response.ok) await response.arrayBuffer();
  } catch {
    // Warming is opportunistic. The mounted iframe remains the retry path.
  } finally {
    clearTimeout(timeout);
  }
}

export async function warmCoursewarePreviewPage(
  doc: CoursewareDoc,
  bindingUrls: ResolvedBindingUrls,
): Promise<void> {
  await Promise.all(collectCoursewarePreviewWarmTargets(doc, bindingUrls).map((target) => (
    target.kind === "image" ? warmImage(target.url) : warmH5Entry(target.url)
  )));
}

import type {
  CoursewarePreviewPagePayload,
  CoursewareTrack,
} from "@/features/courseware-studio/data";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";

const SIGNED_COURSEWARE_OBJECT_PREFIX = "/storage/v1/object/sign/cw-objects/";

/**
 * Supabase emits a fresh token for the same immutable CAS path on every page
 * request. Reuse the first still-valid URL within one opened preview so shared
 * backgrounds and repeated source assets keep one browser-cache identity.
 */
export function reuseCoursewareObjectUrls(
  urls: ResolvedBindingUrls,
  knownUrls: Map<string, string>,
): ResolvedBindingUrls {
  return Object.fromEntries(Object.entries(urls).map(([bindingKey, url]) => {
    try {
      const parsed = new URL(url);
      if (!parsed.pathname.startsWith(SIGNED_COURSEWARE_OBJECT_PREFIX)) return [bindingKey, url];
      const objectKey = `${parsed.origin}${parsed.pathname}`;
      const known = knownUrls.get(objectKey);
      if (known) return [bindingKey, known];
      knownUrls.set(objectKey, url);
    } catch {
      // Relative H5/runtime URLs already have stable cache identities.
    }
    return [bindingKey, url];
  }));
}

export async function fetchCoursewarePreviewPage(input: {
  releaseId: string;
  track: CoursewareTrack;
  pageDocId: string;
}): Promise<CoursewarePreviewPagePayload> {
  const query = new URLSearchParams({ track: input.track });
  const response = await fetch(
    `/api/courseware-preview/releases/${encodeURIComponent(input.releaseId)}/pages/${encodeURIComponent(input.pageDocId)}?${query}`,
    {
      cache: "no-store",
      credentials: "same-origin",
    },
  );
  const body = await response.json().catch(() => null) as CoursewarePreviewPagePayload | { code?: unknown } | null;
  if (!response.ok) {
    const code = body && "code" in body && typeof body.code === "string" ? body.code : "PREVIEW_PAGE_LOAD_FAILED";
    throw new Error(code);
  }
  return body as CoursewarePreviewPagePayload;
}

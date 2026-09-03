import type {
  CoursewarePreviewPagePayload,
  CoursewareTrack,
} from "@/features/courseware-studio/data";

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

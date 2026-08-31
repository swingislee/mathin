import "server-only";

import { notFound } from "next/navigation";
import { getLectureWorkspaceDetail, isUuid } from "@/features/school/curriculum/lecture-workspace-detail";
import { requirePerm } from "@/lib/auth";
import { loadLecturePreview } from "./data";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** Step 1 reads immutable releases only; it does not load editor heads or actions. */
export async function loadUnifiedCoursewareWorkspaceData(
  locale: string,
  lectureId: string,
  rawSearchParams: Record<string, string | string[] | undefined>,
) {
  if (!isUuid(lectureId)) notFound();
  await requirePerm(locale, "course.view");

  const requestedPageRaw = Number(first(rawSearchParams.page));
  const requestedPage = Number.isInteger(requestedPageRaw) && requestedPageRaw > 0 ? requestedPageRaw : 1;
  const detail = await getLectureWorkspaceDetail(lectureId).catch((error) => {
    if (error instanceof Error && (error.message.includes("LECTURE_NOT_FOUND") || error.message.includes("FORBIDDEN_SCOPE"))) return null;
    throw error;
  });
  if (!detail) notFound();

  const [nativePreview, adaptedPreview] = await Promise.all([
    loadLecturePreview(lectureId, "native-16x9", requestedPage),
    loadLecturePreview(lectureId, "adapted-4x3", requestedPage),
  ]);

  return {
    detail,
    requestedPage,
    nativePreview: nativePreview?.lecture.courseId === detail.variant.id ? nativePreview : null,
    adaptedPreview: adaptedPreview?.lecture.courseId === detail.variant.id ? adaptedPreview : null,
  };
}

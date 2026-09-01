import "server-only";

import { notFound } from "next/navigation";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import { PAGE_DOC_VERSION, type PageDoc } from "@/features/courseware-doc/schema";
import { getLectureWorkspaceDetail, isUuid } from "@/features/school/curriculum/lecture-workspace-detail";
import { requirePerm } from "@/lib/auth";
import {
  loadCoursewareStudioPage,
  loadLecturePreview,
  parseCoursewareTrack,
  type CoursewareTrack,
} from "./data";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export interface UnifiedPageDocEditorData {
  pageDocId: string;
  pageNo: number;
  pageTitle: string;
  track: CoursewareTrack;
  doc: PageDoc;
  baseRevisionNo: number;
  bindingUrls: ResolvedBindingUrls;
}

/**
 * The formal workspace is an editor route. PageDoc pages read their draft head;
 * source-owned runtimes remain explicit read-only canvases until they expose a
 * supported patch protocol.
 */
export async function loadUnifiedCoursewareWorkspaceData(
  locale: string,
  lectureId: string,
  rawSearchParams: Record<string, string | string[] | undefined>,
) {
  if (!isUuid(lectureId)) notFound();
  await Promise.all([
    requirePerm(locale, "course.view"),
    requirePerm(locale, "courseware.page.edit"),
  ]);

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

  const safeNativePreview = nativePreview?.lecture.courseId === detail.variant.id ? nativePreview : null;
  const safeAdaptedPreview = adaptedPreview?.lecture.courseId === detail.variant.id ? adaptedPreview : null;
  const requestedTrack = parseCoursewareTrack(rawSearchParams.track);
  const requestedCanvas = first(rawSearchParams.canvas);
  const editorTrack: CoursewareTrack = requestedCanvas === "adapted-4x3" && requestedTrack === "adapted-4x3" && safeAdaptedPreview
    ? "adapted-4x3"
    : safeNativePreview
      ? "native-16x9"
      : "adapted-4x3";
  const editorPreview = editorTrack === "adapted-4x3" ? safeAdaptedPreview : safeNativePreview;
  let pageEditor: UnifiedPageDocEditorData | null = null;

  if (editorPreview) {
    const studioPage = await loadCoursewareStudioPage(
      lectureId,
      editorPreview.page.pageDocId,
      editorTrack,
    );
    if (studioPage?.activeRevision.doc.docVersion === PAGE_DOC_VERSION) {
      pageEditor = {
        pageDocId: studioPage.page.id,
        pageNo: studioPage.page.pageNo,
        pageTitle: studioPage.page.title,
        track: editorTrack,
        doc: studioPage.activeRevision.doc,
        baseRevisionNo: studioPage.activeRevision.revisionNo,
        bindingUrls: studioPage.bindingUrls,
      };
    }
  }

  return {
    detail,
    requestedPage,
    nativePreview: safeNativePreview,
    adaptedPreview: safeAdaptedPreview,
    pageEditor,
  };
}

import "server-only";

import { notFound } from "next/navigation";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import { PAGE_DOC_VERSION, type PageDoc } from "@/features/courseware-doc/schema";
import { getLectureWorkspaceDetail, isUuid } from "@/features/school/curriculum/lecture-workspace-detail";
import { requirePerm } from "@/lib/auth";
import { loadCoursewareStudioPage, loadLecturePreview } from "./data";
import {
  isPageDocVerticalSliceSample,
  PAGE_DOC_VERTICAL_SLICE_SAMPLE,
} from "./page-doc-vertical-slice";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export interface UnifiedPageDocEditorData {
  pageDocId: string;
  pageNo: number;
  pageTitle: string;
  track: "native-16x9";
  doc: PageDoc;
  baseRevisionNo: number;
  bindingUrls: ResolvedBindingUrls;
}

/**
 * Normal workspace reads immutable releases. Step 3 adds one explicit,
 * permission-gated local PageDoc sample whose canvas reads its draft head.
 */
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

  const safeNativePreview = nativePreview?.lecture.courseId === detail.variant.id ? nativePreview : null;
  const safeAdaptedPreview = adaptedPreview?.lecture.courseId === detail.variant.id ? adaptedPreview : null;
  const pageEditorRequested = isPageDocVerticalSliceSample({
    mode: first(rawSearchParams.edit),
    lectureId,
    pageDocId: safeNativePreview?.page.pageDocId,
    pageNo: requestedPage,
  });
  let pageEditor: UnifiedPageDocEditorData | null = null;

  if (pageEditorRequested) {
    await requirePerm(locale, "courseware.page.edit");
    const studioPage = await loadCoursewareStudioPage(
      PAGE_DOC_VERTICAL_SLICE_SAMPLE.lectureId,
      PAGE_DOC_VERTICAL_SLICE_SAMPLE.pageDocId,
      PAGE_DOC_VERTICAL_SLICE_SAMPLE.track,
    );
    if (studioPage?.activeRevision.doc.docVersion === PAGE_DOC_VERSION) {
      pageEditor = {
        pageDocId: studioPage.page.id,
        pageNo: studioPage.page.pageNo,
        pageTitle: studioPage.page.title,
        track: PAGE_DOC_VERTICAL_SLICE_SAMPLE.track,
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

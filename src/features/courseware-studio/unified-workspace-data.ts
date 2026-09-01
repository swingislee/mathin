import "server-only";

import { notFound } from "next/navigation";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import type { LegacyCourseware43AdaptClass } from "@/features/courseware-doc/courseware-4x3-strategy";
import { PAGE_DOC_VERSION, type PageDoc } from "@/features/courseware-doc/schema";
import { getLectureWorkspaceDetail, isUuid } from "@/features/school/curriculum/lecture-workspace-detail";
import { requirePerm } from "@/lib/auth";
import {
  loadCoursewareStudioPage,
  loadLecturePreview,
  parseCoursewareTrack,
  type StudioImageAssetUsage,
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
  imageAssetUsage: Record<string, StudioImageAssetUsage>;
  replacementContext: {
    lectureId: string;
    courseId: string;
    familyId: string;
  };
  fourByThreeSource: {
    doc: PageDoc;
    bindingUrls: ResolvedBindingUrls;
  };
  fourByThreeDraft: {
    doc: PageDoc;
    baseRevisionNo: number;
    materialized: boolean;
  };
  legacyAdaptClass: LegacyCourseware43AdaptClass | null;
}

function isFourByThreePageDoc(doc: PageDoc) {
  return doc.canvas.width * 3 === doc.canvas.height * 4;
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
  let pageEditor: UnifiedPageDocEditorData | null = null;
  const pageDocId = safeNativePreview?.page.pageDocId ?? safeAdaptedPreview?.page.pageDocId ?? null;

  if (pageDocId) {
    const [nativeStudioPage, adaptedStudioPage] = await Promise.all([
      loadCoursewareStudioPage(lectureId, pageDocId, "native-16x9"),
      loadCoursewareStudioPage(lectureId, pageDocId, "adapted-4x3"),
    ]);
    const nativePageDoc = nativeStudioPage?.activeRevision.doc.docVersion === PAGE_DOC_VERSION
      ? { studioPage: nativeStudioPage, doc: nativeStudioPage.activeRevision.doc }
      : null;
    const adaptedPageDoc = adaptedStudioPage?.activeRevision.doc.docVersion === PAGE_DOC_VERSION
      ? { studioPage: adaptedStudioPage, doc: adaptedStudioPage.activeRevision.doc }
      : null;
    const editableAdaptedPage = adaptedPageDoc && isFourByThreePageDoc(adaptedPageDoc.doc)
      ? adaptedPageDoc
      : null;
    const editorTrack: CoursewareTrack = requestedCanvas === "adapted-4x3"
      && requestedTrack === "adapted-4x3"
      && editableAdaptedPage
      ? "adapted-4x3"
      : nativePageDoc
        ? "native-16x9"
        : "adapted-4x3";
    const studioPage = editorTrack === "adapted-4x3" ? editableAdaptedPage : nativePageDoc;
    const fourByThreeSource = nativePageDoc ?? studioPage;
    const fourByThreeBaseline = adaptedPageDoc ?? fourByThreeSource;
    if (studioPage && fourByThreeSource && fourByThreeBaseline) {
      const editorBindingUrls = editorTrack === "adapted-4x3"
        ? {
            ...(nativePageDoc?.studioPage.bindingUrls ?? {}),
            ...studioPage.studioPage.bindingUrls,
          }
        : studioPage.studioPage.bindingUrls;
      const editorImageAssetUsage = editorTrack === "adapted-4x3"
        ? {
            ...(nativePageDoc?.studioPage.imageAssetUsage ?? {}),
            ...studioPage.studioPage.imageAssetUsage,
          }
        : studioPage.studioPage.imageAssetUsage;
      pageEditor = {
        pageDocId: studioPage.studioPage.page.id,
        pageNo: studioPage.studioPage.page.pageNo,
        pageTitle: studioPage.studioPage.page.title,
        track: editorTrack,
        doc: studioPage.doc,
        baseRevisionNo: studioPage.studioPage.activeRevision.revisionNo,
        bindingUrls: editorBindingUrls,
        imageAssetUsage: editorImageAssetUsage,
        replacementContext: {
          lectureId: detail.lecture.id,
          courseId: detail.variant.id,
          familyId: detail.family.id,
        },
        fourByThreeSource: {
          doc: fourByThreeSource.doc,
          bindingUrls: fourByThreeSource.studioPage.bindingUrls,
        },
        fourByThreeDraft: {
          doc: fourByThreeBaseline.doc,
          baseRevisionNo: fourByThreeBaseline.studioPage.activeRevision.revisionNo,
          materialized: Boolean(editableAdaptedPage),
        },
        legacyAdaptClass: nativePageDoc?.studioPage.page.adaptClass ?? adaptedPageDoc?.studioPage.page.adaptClass ?? null,
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

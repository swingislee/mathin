import { CircleAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CoursewareWorkbench,
  CoursewareWorkbenchDirectoryHeader,
  CoursewareWorkbenchPager,
} from "@/features/courseware-doc/CoursewareEditorWorkbench";
import { isSourceRuntimePageDoc } from "@/features/courseware-doc/source-runtime-schema";
import { isSpatialPageDoc } from "@/features/courseware-doc/spatial";
import {
  ObjectBar,
  ObjectTabs,
  ObjectWorkspace,
} from "@/features/school/object-workspace";
import type { LectureWorkspaceDetail } from "@/features/school/curriculum/types";
import type { CoursewareLecturePreview, CoursewareTrack } from "./data";
import { CoursewareFormalPageRail } from "./CoursewareFormalPageRail";
import { FittedCoursewareCanvas } from "./FittedCoursewareCanvas";
import { PageDocVerticalSliceEditor } from "./PageDocVerticalSliceEditor";
import { StagePreview } from "./StagePreview";
import { SourceRuntimeFourByThreeEditor } from "./SourceRuntimeFourByThreeEditor";
import type {
  UnifiedPageDocEditorData,
  UnifiedSourceRuntimeEditorData,
} from "./unified-workspace-data";

export const UNIFIED_WORKSPACE_CANVASES = ["compare", "native-16x9", "adapted-4x3"] as const;
export type UnifiedWorkspaceCanvas = (typeof UNIFIED_WORKSPACE_CANVASES)[number];

export function parseUnifiedWorkspaceCanvas(value: string | string[] | undefined): UnifiedWorkspaceCanvas {
  const first = Array.isArray(value) ? value[0] : value;
  return first === "native-16x9" || first === "adapted-4x3" ? first : "compare";
}

function previewAspect(preview: CoursewareLecturePreview) {
  if (preview.page.aspect === "4:3") return 4 / 3;
  if (isSourceRuntimePageDoc(preview.page.doc)) {
    return preview.page.doc.viewport.width / preview.page.doc.viewport.height;
  }
  if (isSpatialPageDoc(preview.page.doc)) return 16 / 9;
  return "canvas" in preview.page.doc
    ? preview.page.doc.canvas.width / preview.page.doc.canvas.height
    : 16 / 9;
}

function workspaceHref({
  lectureId,
  canvas,
  track,
  page,
  returnTo,
}: {
  lectureId: string;
  canvas: UnifiedWorkspaceCanvas;
  track: CoursewareTrack;
  page: number;
  returnTo: string | null;
}) {
  const query = new URLSearchParams({ workspace: "courseware", canvas, track });
  if (page > 1) query.set("page", String(page));
  if (returnTo) query.set("returnTo", returnTo);
  return `/dashboard/courseware/lectures/${lectureId}?${query.toString()}`;
}

function coursePreviewHref(detail: LectureWorkspaceDetail, track: CoursewareTrack, page: number) {
  const query = new URLSearchParams({
    variant: detail.variant.id,
    lecture: detail.lecture.id,
    track,
  });
  if (page > 1) query.set("page", String(page));
  return `/dashboard/courses/${detail.family.id}?${query.toString()}`;
}

function TrackCanvas({
  preview,
  label,
  unavailable,
}: {
  preview: CoursewareLecturePreview | null;
  label: string;
  unavailable: string;
}) {
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-paper" aria-label={label}>
      {preview ? (
        <FittedCoursewareCanvas aspect={previewAspect(preview)}>
          <StagePreview
            doc={preview.page.doc}
            bindingUrls={preview.bindingUrls}
            stageMode={preview.page.aspect === "4:3" ? "board43" : "natural"}
            className="size-full"
          />
        </FittedCoursewareCanvas>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center px-6 text-center text-sm text-muted">{unavailable}</div>
      )}
    </section>
  );
}

export async function UnifiedCoursewareWorkspace({
  detail,
  nativePreview,
  adaptedPreview,
  pageEditor,
  sourceRuntimeEditor,
  canvas,
  entryTrack,
  returnTo,
}: {
  detail: LectureWorkspaceDetail;
  nativePreview: CoursewareLecturePreview | null;
  adaptedPreview: CoursewareLecturePreview | null;
  pageEditor: UnifiedPageDocEditorData | null;
  sourceRuntimeEditor: UnifiedSourceRuntimeEditorData | null;
  canvas: UnifiedWorkspaceCanvas;
  entryTrack: CoursewareTrack;
  returnTo: string | null;
}) {
  const t = await getTranslations("coursewareWorkspace");
  const directoryPreview = nativePreview ?? adaptedPreview;
  const pageIndex = directoryPreview?.pageIndex ?? 1;
  const pages = directoryPreview?.pages ?? [];
  const backHref = returnTo ?? coursePreviewHref(detail, entryTrack, pageIndex);
  const selectedPage = directoryPreview?.page;
  const sessionAdaptationAvailable = Boolean(pageEditor || sourceRuntimeEditor);
  const adaptedCanvasFellBack = canvas === "adapted-4x3"
    && !adaptedPreview
    && Boolean(nativePreview)
    && !sessionAdaptationAvailable;
  const visibleCanvas: UnifiedWorkspaceCanvas = adaptedCanvasFellBack ? "native-16x9" : canvas;
  const visibleTrack: CoursewareTrack = visibleCanvas === "adapted-4x3" ? "adapted-4x3" : "native-16x9";
  const selectedDoc = pageEditor?.doc ?? sourceRuntimeEditor?.doc ?? (visibleCanvas === "adapted-4x3"
    ? adaptedPreview?.page.doc
    : nativePreview?.page.doc ?? adaptedPreview?.page.doc);
  const canvasItems = [
    { value: "compare", label: t("canvasCompare"), href: workspaceHref({ lectureId: detail.lecture.id, canvas: "compare", track: "native-16x9", page: pageIndex, returnTo }) },
    { value: "native-16x9", label: t("canvasNative"), href: workspaceHref({ lectureId: detail.lecture.id, canvas: "native-16x9", track: "native-16x9", page: pageIndex, returnTo }) },
    { value: "adapted-4x3", label: t("canvasAdapted"), href: workspaceHref({ lectureId: detail.lecture.id, canvas: "adapted-4x3", track: "adapted-4x3", page: pageIndex, returnTo }) },
  ];

  const previousHref = pageIndex > 1
    ? workspaceHref({ lectureId: detail.lecture.id, canvas: visibleCanvas, track: visibleTrack, page: pageIndex - 1, returnTo })
    : null;
  const nextHref = pageIndex < pages.length
    ? workspaceHref({ lectureId: detail.lecture.id, canvas: visibleCanvas, track: visibleTrack, page: pageIndex + 1, returnTo })
    : null;
  const directoryItems = pages.map((page, index) => {
    const nativePage = nativePreview?.pages[index];
    const adaptedPage = adaptedPreview?.pages[index];
    return {
      id: page.pageDocId,
      title: page.title || t("untitledPage"),
      href: workspaceHref({
        lectureId: detail.lecture.id,
        canvas: visibleCanvas,
        track: visibleTrack,
        page: index + 1,
        returnTo,
      }),
      nativeAvailable: Boolean(nativePage),
      adaptedAvailable: Boolean(adaptedPage || (nativePage && sessionAdaptationAvailable)),
    };
  });

  return (
    <ObjectWorkspace
      scroll="internal"
      objectBar={<ObjectBar
        title={t("lectureTitle", { no: detail.lecture.no, name: detail.lecture.name })}
        backHref={backHref}
        backLabel={t("backToCourseProduct")}
        context={[
          { value: detail.family.title },
          { value: detail.variant.title },
          { value: t("pageContext", { page: pageIndex, total: pages.length }) },
        ]}
        status={<Badge variant="outline">{t(pageEditor ? "formalEditorStatus" : sourceRuntimeEditor ? "sourceEditorStatus" : "sourceReadOnlyStatus")}</Badge>}
      />}
      navigation={(
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <ObjectTabs items={canvasItems} activeValue={visibleCanvas} ariaLabel={t("canvasNavigation")} />
          {adaptedCanvasFellBack ? (
            <p className="flex min-w-0 flex-1 items-center gap-2 text-xs leading-5 text-amber-700 dark:text-amber-300" role="status">
              <CircleAlert className="size-4 shrink-0" />
              <span>{t("adaptedFallbackNotice")}</span>
            </p>
          ) : null}
        </div>
      )}
    >
      <CoursewareWorkbench
        mode="formal-editor"
        data-unified-courseware-workspace
        adapter={selectedDoc?.docVersion ?? "unknown"}
        layout="workspace"
        layoutId={`formal-courseware-${detail.lecture.id}`}
        className="mx-1 -mb-4 min-h-0 min-w-0 flex-1 lg:-mb-5"
        directory={{
          ariaLabel: t("pageDirectory"),
          width: "wide",
          header: <CoursewareWorkbenchDirectoryHeader
            title={t("pageDirectory")}
            meta={t("pageCount", { count: pages.length })}
          />,
          content: pages.length > 0
            ? <CoursewareFormalPageRail
                items={directoryItems}
                selectedIndex={pageIndex - 1}
                editablePageId={selectedPage?.pageDocId ?? null}
              />
            : <p className="px-3 py-6 text-sm text-muted">{t("noReleasedPages")}</p>,
        }}
        canvas={{
          ariaLabel: t("previewTitle"),
          content: <div className="size-full min-h-0 overflow-hidden bg-moon/10">
            {pageEditor ? (
              <PageDocVerticalSliceEditor
                key={`${pageEditor.pageDocId}:${pageEditor.baseRevisionNo}:${pageEditor.fourByThreeDraft?.baseRevisionNo ?? "no-4x3"}:${visibleCanvas}`}
                pageDocId={pageEditor.pageDocId}
                track={pageEditor.track}
                view={visibleCanvas}
                initialDoc={pageEditor.doc}
                baseRevisionNo={pageEditor.baseRevisionNo}
                bindingUrls={pageEditor.bindingUrls}
                imageAssetUsage={pageEditor.imageAssetUsage}
                replacementContext={pageEditor.replacementContext}
                fourByThreeSource={pageEditor.fourByThreeSource}
                fourByThreeDraft={pageEditor.fourByThreeDraft}
                legacyAdaptClass={pageEditor.legacyAdaptClass}
              />
            ) : sourceRuntimeEditor ? (
              <SourceRuntimeFourByThreeEditor
                key={`${sourceRuntimeEditor.pageDocId}:${sourceRuntimeEditor.baseRevisionNo}:${sourceRuntimeEditor.fourByThreeDraft.baseRevisionNo}:${visibleCanvas}`}
                pageDocId={sourceRuntimeEditor.pageDocId}
                track={sourceRuntimeEditor.track}
                initialDoc={sourceRuntimeEditor.doc}
                baseRevisionNo={sourceRuntimeEditor.baseRevisionNo}
                bindingUrls={sourceRuntimeEditor.bindingUrls}
                fourByThreeSource={sourceRuntimeEditor.fourByThreeSource}
                fourByThreeDraft={sourceRuntimeEditor.fourByThreeDraft}
                view={visibleCanvas}
              />
            ) : visibleCanvas === "compare" ? (
              <div className="grid size-full min-h-0 grid-rows-2 gap-px bg-line @4xl/workspace:grid-cols-2 @4xl/workspace:grid-rows-1">
                <TrackCanvas preview={nativePreview} label={t("canvasNative")} unavailable={t("nativeUnavailable")} />
                <TrackCanvas preview={adaptedPreview} label={t("canvasAdapted")} unavailable={t("adaptedUnavailable")} />
              </div>
            ) : visibleCanvas === "adapted-4x3" ? (
              <TrackCanvas preview={adaptedPreview} label={t("canvasAdapted")} unavailable={t("adaptedUnavailable")} />
            ) : (
              <TrackCanvas preview={nativePreview} label={t("canvasNative")} unavailable={t("nativeUnavailable")} />
            )}
          </div>,
          footer: <CoursewareWorkbenchPager
            previousLabel={t("previousPage")}
            nextLabel={t("nextPage")}
            previousDisabled={!previousHref}
            nextDisabled={!nextHref}
            previousHref={previousHref}
            nextHref={nextHref}
            center={<span className="text-xs tabular-nums text-muted">{t("pageContext", { page: pageIndex, total: pages.length })}</span>}
          />,
        }}
        toolbar={pageEditor || sourceRuntimeEditor ? undefined : <span className="text-xs text-muted">{t("sourceReadOnlyToolbar")}</span>}
        saveControls={pageEditor || sourceRuntimeEditor ? undefined : <Badge variant="outline">{t("sourceReadOnlyStatus")}</Badge>}
        inspector={{
          ariaLabel: t("propertiesTitle"),
          header: <h2 className="shrink-0 text-sm font-medium text-ink">{t("propertiesTitle")}</h2>,
          content: pageEditor || sourceRuntimeEditor ? undefined : <ScrollArea className="size-full min-h-0">
            <div className="px-4 py-5">
              <p className="text-sm font-medium text-ink">{t("sourceReadOnlyTitle")}</p>
              <p className="mt-2 text-xs leading-5 text-muted">{t("sourceReadOnlyDescription")}</p>
            </div>
          </ScrollArea>,
        }}
      />
    </ObjectWorkspace>
  );
}

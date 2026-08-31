import { ChevronLeft, ChevronRight, ImageIcon, LayoutTemplate, Plus, Type } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { isSourceRuntimePageDoc } from "@/features/courseware-doc/source-runtime-schema";
import { isSpatialPageDoc } from "@/features/courseware-doc/spatial";
import {
  ObjectBar,
  ObjectTabs,
  ObjectWorkspace,
} from "@/features/school/object-workspace";
import { StatusStrip } from "@/features/school/dashboard-page";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { LectureWorkspaceDetail } from "@/features/school/curriculum/types";
import type { CoursewareLecturePreview, CoursewareTrack } from "./data";
import { FittedCoursewareCanvas } from "./FittedCoursewareCanvas";
import { StagePreview } from "./StagePreview";

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
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-paper" aria-label={label}>
      <div className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="text-xs font-medium text-ink">{label}</span>
        <Badge variant={preview ? "secondary" : "outline"}>{preview ? `R${preview.release.releaseNo}` : unavailable}</Badge>
      </div>
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

function CapabilityRow({
  icon,
  title,
  description,
  pendingLabel,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  pendingLabel: string;
}) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="mt-0.5 text-crater">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-muted">{description}</span>
      </span>
      <Badge variant="outline" className="shrink-0">{pendingLabel}</Badge>
    </li>
  );
}

export async function UnifiedCoursewareWorkspace({
  detail,
  nativePreview,
  adaptedPreview,
  canvas,
  entryTrack,
  returnTo,
}: {
  detail: LectureWorkspaceDetail;
  nativePreview: CoursewareLecturePreview | null;
  adaptedPreview: CoursewareLecturePreview | null;
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
  const selectedDoc = canvas === "adapted-4x3"
    ? adaptedPreview?.page.doc
    : nativePreview?.page.doc ?? adaptedPreview?.page.doc;

  const canvasItems = [
    { value: "compare", label: t("canvasCompare"), href: workspaceHref({ lectureId: detail.lecture.id, canvas: "compare", track: entryTrack, page: pageIndex, returnTo }) },
    { value: "native-16x9", label: t("canvasNative"), href: workspaceHref({ lectureId: detail.lecture.id, canvas: "native-16x9", track: entryTrack, page: pageIndex, returnTo }) },
    { value: "adapted-4x3", label: t("canvasAdapted"), href: workspaceHref({ lectureId: detail.lecture.id, canvas: "adapted-4x3", track: entryTrack, page: pageIndex, returnTo }) },
  ];

  const previousHref = pageIndex > 1
    ? workspaceHref({ lectureId: detail.lecture.id, canvas, track: entryTrack, page: pageIndex - 1, returnTo })
    : null;
  const nextHref = pageIndex < pages.length
    ? workspaceHref({ lectureId: detail.lecture.id, canvas, track: entryTrack, page: pageIndex + 1, returnTo })
    : null;

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
        status={<Badge variant="outline">{t("readOnlyAudit")}</Badge>}
      />}
      navigation={<ObjectTabs items={canvasItems} activeValue={canvas} ariaLabel={t("canvasNavigation")} />}
      statusStrip={<StatusStrip items={[
        { label: t("statusStep"), value: t("statusStepValue") },
        { label: t("statusNative"), value: nativePreview ? t("releaseNo", { no: nativePreview.release.releaseNo }) : t("unavailable") },
        { label: t("statusAdapted"), value: adaptedPreview ? t("releaseNo", { no: adaptedPreview.release.releaseNo }) : t("unavailable") },
        { label: t("statusPage"), value: `${pageIndex}/${pages.length}` },
      ]} />}
    >
      <div
        data-unified-courseware-workspace
        className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(10rem,28dvh)_minmax(22rem,1fr)_minmax(10rem,30dvh)] @4xl/workspace:grid-cols-[224px_minmax(0,1fr)_320px] @4xl/workspace:grid-rows-1"
      >
        <aside className="flex min-h-0 min-w-0 flex-col border-b border-line @4xl/workspace:border-b-0 @4xl/workspace:border-r" aria-label={t("pageDirectory")}>
          <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 px-3 py-2">
            <h2 className="text-xs font-medium text-muted">{t("pageDirectory")}</h2>
            <span className="text-xs tabular-nums text-muted">{t("pageCount", { count: pages.length })}</span>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            {pages.length > 0 ? (
              <ol className="divide-y divide-line/70">
                {pages.map((page, index) => {
                  const active = index + 1 === pageIndex;
                  const nativePage = nativePreview?.pages[index];
                  const adaptedPage = adaptedPreview?.pages[index];
                  return (
                    <li key={page.pageDocId}>
                      <Link
                        href={workspaceHref({ lectureId: detail.lecture.id, canvas, track: entryTrack, page: index + 1, returnTo })}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-12 items-center gap-2 px-3 py-2 transition-colors hover:bg-moon/20",
                          active && "bg-crater/10",
                        )}
                      >
                        <span className="w-5 shrink-0 text-right font-mono text-[11px] text-muted">{index + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-ink">{page.title || t("untitledPage")}</span>
                        <span className="flex shrink-0 gap-1" aria-label={t("trackAvailability")}>
                          {nativePage ? <span className="size-1.5 rounded-full bg-crater" title={t("canvasNative")} /> : null}
                          {adaptedPage ? <span className="size-1.5 rounded-full bg-amber-500" title={t("canvasAdapted")} /> : null}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            ) : <p className="px-3 py-6 text-sm text-muted">{t("noReleasedPages")}</p>}
          </ScrollArea>
        </aside>

        <main className="@container/page flex min-h-0 min-w-0 flex-col overflow-hidden" aria-label={t("previewTitle")}>
          <div className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-line px-3 py-2">
            <h2 className="text-xs font-medium text-muted">{t("previewTitle")}</h2>
            <span className="min-w-0 truncate text-xs text-muted">{selectedPage?.title || t("untitledPage")}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden bg-moon/10">
            {canvas === "compare" ? (
              <div className="grid size-full min-h-0 grid-rows-2 gap-px bg-line @4xl/workspace:grid-cols-2 @4xl/workspace:grid-rows-1">
                <TrackCanvas preview={nativePreview} label={t("canvasNative")} unavailable={t("nativeUnavailable")} />
                <TrackCanvas preview={adaptedPreview} label={t("canvasAdapted")} unavailable={t("adaptedUnavailable")} />
              </div>
            ) : canvas === "adapted-4x3" ? (
              <TrackCanvas preview={adaptedPreview} label={t("canvasAdapted")} unavailable={t("adaptedUnavailable")} />
            ) : (
              <TrackCanvas preview={nativePreview} label={t("canvasNative")} unavailable={t("nativeUnavailable")} />
            )}
          </div>
          <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-t border-line px-2 py-1.5">
            {previousHref ? (
              <Link href={previousHref} className={buttonVariants({ variant: "ghost", size: "sm" })}><ChevronLeft size={15} />{t("previousPage")}</Link>
            ) : <span />}
            <span className="text-xs tabular-nums text-muted">{t("pageContext", { page: pageIndex, total: pages.length })}</span>
            {nextHref ? (
              <Link href={nextHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>{t("nextPage")}<ChevronRight size={15} /></Link>
            ) : <span />}
          </div>
        </main>

        <aside className="flex min-h-0 min-w-0 flex-col border-t border-line @4xl/workspace:border-l @4xl/workspace:border-t-0" aria-label={t("propertiesTitle")}>
          <div className="min-h-11 shrink-0 border-b border-line px-4 py-3">
            <h2 className="text-sm font-medium text-ink">{t("propertiesTitle")}</h2>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="divide-y divide-line px-4">
              <section className="py-4">
                <p className="text-xs leading-5 text-muted">{t("readOnlyHint")}</p>
                <dl className="mt-3 space-y-2 text-xs">
                  <div className="flex items-start justify-between gap-3"><dt className="text-muted">{t("pageIdentity")}</dt><dd className="max-w-[11rem] truncate text-right text-ink">{selectedPage?.pageDocId ?? "—"}</dd></div>
                  <div className="flex items-start justify-between gap-3"><dt className="text-muted">{t("sourceType")}</dt><dd className="text-right text-ink">{selectedDoc?.docVersion ?? "—"}</dd></div>
                  <div className="flex items-start justify-between gap-3"><dt className="text-muted">{t("entryTrack")}</dt><dd className="text-right text-ink">{entryTrack === "adapted-4x3" ? t("canvasAdapted") : t("canvasNative")}</dd></div>
                </dl>
              </section>
              <section className="py-4">
                <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-muted">{t("capabilitiesTitle")}</h3>
                <ul className="mt-1 divide-y divide-line/70">
                  <CapabilityRow icon={<Type size={16} />} title={t("contentEditing")} description={t("contentEditingHint")} pendingLabel={t("step2Pending")} />
                  <CapabilityRow icon={<LayoutTemplate size={16} />} title={t("layoutAdaptation")} description={t("layoutAdaptationHint")} pendingLabel={t("step2Pending")} />
                  <CapabilityRow icon={<ImageIcon size={16} />} title={t("resourceReplacement")} description={t("resourceReplacementHint")} pendingLabel={t("step2Pending")} />
                  <CapabilityRow icon={<Plus size={16} />} title={t("contentInsertion")} description={t("contentInsertionHint")} pendingLabel={t("step2Pending")} />
                </ul>
              </section>
            </div>
          </ScrollArea>
        </aside>
      </div>
    </ObjectWorkspace>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { fetchCoursewarePreviewPage, reuseCoursewareObjectUrls } from "@/features/courseware-preview/client";
import { CoursewarePreviewWorkspace } from "@/features/courseware-preview/CoursewarePreviewWorkspace";
import { warmCoursewarePreviewPage } from "@/features/courseware-preview/preload";
import { isSourceRuntimePageDoc } from "@/features/courseware-doc/source-runtime-schema";
import { isSpatialPageDoc } from "@/features/courseware-doc/spatial";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import type {
  CoursewareLecturePreview,
  CoursewarePreviewPagePayload,
} from "@/features/courseware-studio/data";
import { cn } from "@/lib/utils";

function pageAspect(
  page: CoursewarePreviewPagePayload["page"] | undefined,
  fallback: string,
) {
  const aspect = page?.aspect ?? fallback;
  if (aspect === "4:3") return 4 / 3;
  if (page && isSourceRuntimePageDoc(page.doc)) {
    return page.doc.viewport.width / page.doc.viewport.height;
  }
  if (page && isSpatialPageDoc(page.doc)) return 16 / 9;
  return page && "canvas" in page.doc
    ? page.doc.canvas.width / page.doc.canvas.height
    : 16 / 9;
}

/** Keep the locale-prefixed pathname while replacing only this preview's query state. */
function replacePreviewUrl(href: string) {
  const target = new URL(href, window.location.origin);
  window.history.replaceState(null, "", `${window.location.pathname}${target.search}${target.hash}`);
}

/**
 * Read-only lecture preview with an immutable-release page cache.
 *
 * The first page still arrives with the Server Component response. Subsequent
 * pages are fetched independently, cached for the lifetime of the preview, and
 * the adjacent pages are warmed in the background. Page turns therefore no
 * longer rerun the surrounding course/lecture route.
 */
export function LectureCoursewarePreview({
  preview,
  pageHrefs,
  fillAvailable = false,
}: {
  preview: CoursewareLecturePreview;
  pageHrefs: string[];
  fillAvailable?: boolean;
}) {
  return (
    <LectureCoursewarePreviewState
      key={`${preview.release.id}:${preview.track}`}
      preview={preview}
      pageHrefs={pageHrefs}
      fillAvailable={fillAvailable}
    />
  );
}

function LectureCoursewarePreviewState({
  preview,
  pageHrefs,
  fillAvailable,
}: {
  preview: CoursewareLecturePreview;
  pageHrefs: string[];
  fillAvailable: boolean;
}) {
  const t = useTranslations("school.courses");
  const commonT = useTranslations("common");
  const [selectedIndex, setSelectedIndex] = useState(preview.pageIndex - 1);
  const [initialCache] = useState(() => {
    const knownObjectUrls = new Map<string, string>();
    const initialPayload: CoursewarePreviewPagePayload = {
      page: preview.page,
      bindingUrls: reuseCoursewareObjectUrls(preview.bindingUrls, knownObjectUrls),
    };
    return { knownObjectUrls, initialPayload };
  });
  const knownObjectUrlsRef = useRef(initialCache.knownObjectUrls);
  const cacheRef = useRef(new Map<string, CoursewarePreviewPagePayload>([[
    preview.page.pageDocId,
    initialCache.initialPayload,
  ]]));
  const preparedPageIdsRef = useRef(new Set([preview.page.pageDocId]));
  const [rendered, setRendered] = useState<CoursewarePreviewPagePayload>(initialCache.initialPayload);
  const [errors, setErrors] = useState(new Map<string, string>());
  const pendingRef = useRef(new Map<string, Promise<CoursewarePreviewPagePayload>>());
  const selectedPageIdRef = useRef(preview.page.pageDocId);

  const ensurePage = useCallback((pageDocId: string) => {
    const cached = cacheRef.current.get(pageDocId);
    if (cached && preparedPageIdsRef.current.has(pageDocId)) return Promise.resolve(cached);
    const pending = pendingRef.current.get(pageDocId);
    if (pending) return pending;

    setErrors((current) => {
      if (!current.has(pageDocId)) return current;
      const next = new Map(current);
      next.delete(pageDocId);
      return next;
    });
    const request = (cached
      ? Promise.resolve(cached)
      : fetchCoursewarePreviewPage({
        releaseId: preview.release.id,
        track: preview.track,
        pageDocId,
      })
    ).then(async (payload) => {
      const normalizedPayload = {
        ...payload,
        bindingUrls: reuseCoursewareObjectUrls(payload.bindingUrls, knownObjectUrlsRef.current),
      };
      // Record the immutable payload before resource warming. A slow H5/image
      // warm must not make another page turn repeat the authenticated GET; the
      // prepared set still prevents mounting it before warming has settled.
      cacheRef.current.set(pageDocId, normalizedPayload);
      await warmCoursewarePreviewPage(normalizedPayload.page.doc, normalizedPayload.bindingUrls);
      preparedPageIdsRef.current.add(pageDocId);
      setErrors((current) => {
        if (!current.has(pageDocId)) return current;
        const next = new Map(current);
        next.delete(pageDocId);
        return next;
      });
      return normalizedPayload;
    });
    const settled = request.then(
      (page) => {
        pendingRef.current.delete(pageDocId);
        return page;
      },
      (error: unknown) => {
        pendingRef.current.delete(pageDocId);
        setErrors((current) => new Map(current).set(
          pageDocId,
          error instanceof Error ? error.message : "UNKNOWN",
        ));
        throw error;
      },
    );
    pendingRef.current.set(pageDocId, settled);
    return settled;
  }, [preview.release.id, preview.track]);

  useEffect(() => {
    // Keep the previous page and three forward pages ready. Production page
    // signatures can take about one second; the third forward page hides that
    // latency during fast sequential teaching without whole-lecture eager load.
    for (const index of [selectedIndex - 1, selectedIndex + 1, selectedIndex + 2, selectedIndex + 3]) {
      const page = preview.pages[index];
      if (page) void ensurePage(page.pageDocId).catch(() => undefined);
    }
  }, [ensurePage, preview.pages, selectedIndex]);

  useEffect(() => {
    const selected = preview.pages[selectedIndex];
    if (!selected || selected.pageDocId === rendered.page.pageDocId) return;
    let active = true;
    void ensurePage(selected.pageDocId).then((payload) => {
      if (active && selectedPageIdRef.current === selected.pageDocId) setRendered(payload);
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [ensurePage, preview.pages, rendered.page.pageDocId, selectedIndex]);

  const selectPage = useCallback((index: number) => {
    const page = preview.pages[index];
    const href = pageHrefs[index];
    if (!page || !href) return;
    selectedPageIdRef.current = page.pageDocId;
    setSelectedIndex(index);
    replacePreviewUrl(href);
    const cached = cacheRef.current.get(page.pageDocId);
    if (cached && preparedPageIdsRef.current.has(page.pageDocId)) {
      setRendered(cached);
    }
  }, [pageHrefs, preview.pages]);

  const selectedMeta = preview.pages[selectedIndex] ?? preview.pages[0];
  const loadError = selectedMeta ? errors.get(selectedMeta.pageDocId) : undefined;
  const waitingForSelected = selectedMeta?.pageDocId !== rendered.page.pageDocId;
  const previewAspect = pageAspect(rendered.page, selectedMeta?.aspect ?? "16:9");
  const isFourThree = rendered.page.aspect === "4:3";

  const previewContent = (
    <div className="relative size-full">
      <StagePreview
        doc={rendered.page.doc}
        bindingUrls={rendered.bindingUrls}
        stageMode={isFourThree ? "board43" : "natural"}
        className="size-full"
      />
      {waitingForSelected && !loadError ? (
        <div className="pointer-events-none absolute right-5 top-5 z-20 flex items-center gap-2 rounded-full border border-line bg-card/90 px-3 py-1.5 text-xs text-muted shadow-sm" aria-live="polite">
          <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
          {t("previewPageLoading", { page: selectedIndex + 1 })}
        </div>
      ) : null}
      {waitingForSelected && loadError ? (
        <div className="absolute inset-0 z-20 grid place-items-center bg-card/45 px-6 text-center">
          <div className="rounded-xl border border-line bg-card px-5 py-4 shadow-sm">
            <p className="text-sm text-danger">{t("previewPageLoadFailed")}</p>
            {selectedMeta ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="mt-3"
                onClick={() => void ensurePage(selectedMeta.pageDocId).then((payload) => {
                  if (selectedPageIdRef.current === selectedMeta.pageDocId) setRendered(payload);
                }).catch(() => undefined)}
              >
                {commonT("retry")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className={cn("flex min-h-0 flex-col", fillAvailable ? "h-full" : "h-[min(70dvh,44rem)] min-h-[28rem]")}>
      <CoursewarePreviewWorkspace
        className="flex-1"
        items={preview.pages.map((page) => ({
          id: page.pageDocId,
          title: `${page.pageNo}. ${page.title || t("previewUntitledPage")}`,
        }))}
        selectedIndex={selectedIndex}
        onSelectedIndexChange={selectPage}
        directoryLabel={t("previewDirectory")}
        previewLabel={t("coursewarePreview")}
        previousLabel={t("previousPage")}
        nextLabel={t("nextPage")}
        selectedPageLabel={t("previewPageIndicator", { current: selectedIndex + 1, total: preview.pages.length })}
        previewAspect={previewAspect}
        preview={previewContent}
      />
    </div>
  );
}

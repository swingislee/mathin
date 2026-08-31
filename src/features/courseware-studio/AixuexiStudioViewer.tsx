"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  aixuexiPackageLevel,
  isAixuexiPageDoc,
  type AixuexiPageDoc,
} from "@/features/courseware-doc/aixuexi-schema";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import {
  isSourceRuntimePageDoc,
  type SourceRuntimePageDoc,
} from "@/features/courseware-doc/source-runtime-schema";
import type {
  CoursewareStudioRenderPagePayload,
  CoursewareTrack,
  StudioPageSummary,
} from "./data";
import { CoursewarePageCreateDialog } from "./CoursewarePageCreateDialog";
import { loadCoursewareStudioRenderPageAction } from "./preview-actions";
import { StagePreview } from "./StagePreview";

type ViewerDoc = AixuexiPageDoc | SourceRuntimePageDoc;
type ViewerPayload = Omit<CoursewareStudioRenderPagePayload, "doc"> & { doc: ViewerDoc };

type Props = {
  lecture: { id: string; no: number; name: string };
  track: CoursewareTrack;
  page: StudioPageSummary;
  pages: StudioPageSummary[];
  doc: ViewerDoc;
  bindingUrls: ResolvedBindingUrls;
  lectureWorkspaceHref: string;
};

function isViewerDoc(doc: CoursewareStudioRenderPagePayload["doc"]): doc is ViewerDoc {
  return isAixuexiPageDoc(doc) || isSourceRuntimePageDoc(doc);
}

/** Keep the locale-prefixed Studio pathname while replacing only its page query. */
function replaceStudioUrl(href: string) {
  const target = new URL(href, window.location.origin);
  window.history.replaceState(null, "", `${window.location.pathname}${target.search}${target.hash}`);
}

function baseRevisionId(page: StudioPageSummary) {
  return page.draftRevisionId ?? page.currentRevisionId;
}

export function AixuexiStudioViewer(props: Props) {
  return (
    <AixuexiStudioViewerState
      key={`${props.lecture.id}:${props.track}:${props.page.id}:${props.pages.length}`}
      {...props}
    />
  );
}

function AixuexiStudioViewerState({
  lecture,
  track,
  page,
  pages,
  doc,
  bindingUrls,
  lectureWorkspaceHref,
}: Props) {
  const t = useTranslations("coursewareStudio");
  const commonT = useTranslations("common");
  const router = useRouter();
  const initialIndex = Math.max(0, pages.findIndex((item) => item.id === page.id));
  const initialPayload: ViewerPayload = {
    revisionId: baseRevisionId(page) ?? "",
    doc,
    bindingUrls,
  };
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [renderedPageId, setRenderedPageId] = useState(page.id);
  const [cache, setCache] = useState<Map<string, CoursewareStudioRenderPagePayload>>(
    () => new Map([[page.id, initialPayload]]),
  );
  const [errors, setErrors] = useState(new Map<string, string>());
  const pendingRef = useRef(new Map<string, Promise<CoursewareStudioRenderPagePayload>>());
  const selectedPageIdRef = useRef(page.id);

  const href = useCallback((target: StudioPageSummary) =>
    `/studio/courseware/${lecture.id}?track=${track}&page=${target.id}`, [lecture.id, track]);

  const ensurePage = useCallback((target: StudioPageSummary) => {
    const cached = cache.get(target.id);
    if (cached) return Promise.resolve(cached);
    const pending = pendingRef.current.get(target.id);
    if (pending) return pending;
    const revisionId = baseRevisionId(target);
    if (!revisionId) return Promise.reject(new Error("PAGE_HAS_NO_BASE_REVISION"));

    const request = loadCoursewareStudioRenderPageAction({
      pageDocId: target.id,
      revisionId,
      track,
    }).then((result) => {
      if (!result.ok) throw new Error(result.code);
      setCache((current) => new Map(current).set(target.id, result.data));
      setErrors((current) => {
        if (!current.has(target.id)) return current;
        const next = new Map(current);
        next.delete(target.id);
        return next;
      });
      return result.data;
    });
    const settled = request.then(
      (payload) => {
        pendingRef.current.delete(target.id);
        return payload;
      },
      (error: unknown) => {
        pendingRef.current.delete(target.id);
        setErrors((current) => new Map(current).set(
          target.id,
          error instanceof Error ? error.message : "UNKNOWN",
        ));
        throw error;
      },
    );
    pendingRef.current.set(target.id, settled);
    return settled;
  }, [cache, track]);

  useEffect(() => {
    for (const index of [selectedIndex - 1, selectedIndex + 1]) {
      const target = pages[index];
      if (target) void ensurePage(target).catch(() => undefined);
    }
  }, [ensurePage, pages, selectedIndex]);

  const activatePage = useCallback((index: number) => {
    const target = pages[index];
    if (!target) return;
    selectedPageIdRef.current = target.id;
    setSelectedIndex(index);
    replaceStudioUrl(href(target));

    const cached = cache.get(target.id);
    if (cached && isViewerDoc(cached.doc)) {
      setRenderedPageId(target.id);
      return;
    }
    setErrors((current) => {
      if (!current.has(target.id)) return current;
      const next = new Map(current);
      next.delete(target.id);
      return next;
    });
    void ensurePage(target).then((payload) => {
      if (selectedPageIdRef.current !== target.id) return;
      if (!isViewerDoc(payload.doc)) {
        router.push(href(target));
        return;
      }
      setRenderedPageId(target.id);
    }).catch(() => undefined);
  }, [cache, ensurePage, href, pages, router]);

  const selected = pages[selectedIndex] ?? page;
  const selectedError = errors.get(selected.id);
  const waitingForSelected = renderedPageId !== selected.id;
  const cachedRendered = cache.get(renderedPageId);
  const rendered: ViewerPayload = cachedRendered && isViewerDoc(cachedRendered.doc)
    ? { ...cachedRendered, doc: cachedRendered.doc }
    : initialPayload;
  const packageLevel = aixuexiPackageLevel(rendered.doc.source.packageKey);

  const retrySelected = () => {
    setErrors((current) => {
      if (!current.has(selected.id)) return current;
      const next = new Map(current);
      next.delete(selected.id);
      return next;
    });
    void ensurePage(selected).then((payload) => {
      if (selectedPageIdRef.current !== selected.id) return;
      if (!isViewerDoc(payload.doc)) {
        router.push(href(selected));
        return;
      }
      setRenderedPageId(selected.id);
    }).catch(() => undefined);
  };

  return (
    <div className="@container flex h-full min-h-0 flex-col bg-card">
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-line px-4">
        <Link href={lectureWorkspaceHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          {t("backToLectureWorkspace")}
        </Link>
        <span className="min-w-0 flex-1 truncate text-sm text-ink">
          {t("lectureTitle", { no: lecture.no, name: lecture.name })}
        </span>
        <CoursewarePageCreateDialog
          lectureId={lecture.id}
          afterPageDocId={selected.id}
          track={track}
        />
        <Badge variant="outline">{track === "adapted-4x3" ? "4:3" : "16:9"}</Badge>
        <Badge>{packageLevel ? t("aixuexiAdapterBadge", { level: packageLevel }) : t("aixuexiAdapterBadgeFallback")}</Badge>
      </header>

      <div className="grid min-h-0 flex-1 @4xl:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-r border-line p-3">
          <p className="mb-2 px-2 text-xs font-medium text-muted">{t("pageNavigation")}</p>
          <nav className="space-y-1" aria-label={t("pageNavigation")}>
            {pages.map((item, index) => (
              <Button
                key={item.id}
                type="button"
                variant="ghost"
                size="sm"
                aria-current={item.id === selected.id ? "page" : undefined}
                onClick={() => activatePage(index)}
                className={cn(
                  "h-auto w-full justify-start rounded-lg px-3 py-2 text-left text-sm font-normal transition-colors",
                  item.id === selected.id ? "bg-moon/55 text-ink" : "text-muted hover:bg-moon/30 hover:text-ink",
                )}
              >
                {item.pageNo}. {item.title}
              </Button>
            ))}
          </nav>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col p-4">
          <div className="mb-3 rounded-xl border border-line bg-moon/20 px-4 py-3">
            <p className="text-sm font-medium text-ink">{t("aixuexiReadOnlyTitle")}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{t("aixuexiReadOnlyHint")}</p>
          </div>
          <div
            className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl border border-line bg-paper-lines p-3"
            aria-busy={waitingForSelected}
          >
            <StagePreview
              doc={rendered.doc}
              bindingUrls={rendered.bindingUrls}
              stageMode={track === "adapted-4x3" ? "board43" : "natural"}
              className={track === "adapted-4x3"
                ? "h-full! w-auto! max-w-full"
                : "h-auto! w-full! max-h-full"}
            />
            {waitingForSelected && !selectedError ? (
              <div className="pointer-events-none absolute right-5 top-5 z-20 flex items-center gap-2 rounded-full border border-line bg-card/90 px-3 py-1.5 text-xs text-muted shadow-sm" aria-live="polite">
                <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                {t("pageLoading", { page: selected.pageNo })}
              </div>
            ) : null}
            {waitingForSelected && selectedError ? (
              <div className="absolute inset-0 z-20 grid place-items-center bg-card/45 px-6 text-center">
                <div className="rounded-xl border border-line bg-card px-5 py-4 shadow-sm">
                  <p className="text-sm text-danger">{t("pageLoadFailed", { page: selected.pageNo })}</p>
                  <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={retrySelected}>
                    {commonT("retry")}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
          <footer className="mt-3 flex items-center justify-between gap-3">
            {selectedIndex > 0 ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => activatePage(selectedIndex - 1)}>
                {t("prevPage")}
              </Button>
            ) : <span />}
            <span className="text-xs text-muted">
              {t("pageIndicator", { current: selectedIndex + 1, total: pages.length })}
            </span>
            {selectedIndex < pages.length - 1 ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => activatePage(selectedIndex + 1)}>
                {t("nextPage")}
              </Button>
            ) : <span />}
          </footer>
        </main>
      </div>
    </div>
  );
}

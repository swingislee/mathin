"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import type { PageDoc } from "@/features/courseware-doc/schema";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { StagePreview } from "./StagePreview";

interface CoursewareReviewViewportProps {
  doc: PageDoc;
  bindingUrls: ResolvedBindingUrls;
  stageMode: "natural" | "board43";
  previousHref: string | null;
  nextHref: string | null;
  previousLabel: string;
  nextLabel: string;
  shortcutHint: string;
  pageNavigationLabel: string;
  pages: Array<{ pageNo: number; title: string; href: string; label: string }>;
  currentPage: number;
}

interface FrameSize {
  width: number;
  height: number;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * 审阅页的客户端叶子：把舞台按容器宽高做 contain 缩放，并提供键盘翻页。
 * DocStage 仍只按自身宽度缩放；这里负责给它计算一个不会超出剩余视口的外框。
 */
export function CoursewareReviewViewport({
  doc,
  bindingUrls,
  stageMode,
  previousHref,
  nextHref,
  previousLabel,
  nextLabel,
  shortcutHint,
  pageNavigationLabel,
  pages,
  currentPage,
}: CoursewareReviewViewportProps) {
  const router = useRouter();
  const hostRef = useRef<HTMLDivElement>(null);
  const desktopNavigationRef = useRef<HTMLElement>(null);
  const mobileNavigationRef = useRef<HTMLElement>(null);
  const [frameSize, setFrameSize] = useState<FrameSize>({ width: 0, height: 0 });
  const aspect = stageMode === "board43" ? 4 / 3 : doc.canvas.width / doc.canvas.height;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const update = () => {
      const availableWidth = host.clientWidth;
      const availableHeight = host.clientHeight;
      const width = Math.max(0, Math.min(availableWidth, availableHeight * aspect));
      const height = width / aspect;
      setFrameSize((current) =>
        Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5
          ? current
          : { width, height },
      );
    };

    const observer = new ResizeObserver(update);
    observer.observe(host);
    update();
    return () => observer.disconnect();
  }, [aspect]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented
        || event.repeat
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
        || isEditableTarget(event.target)
      ) return;

      const href = event.key === "ArrowLeft" ? previousHref : event.key === "ArrowRight" ? nextHref : null;
      if (!href) return;
      event.preventDefault();
      router.push(href);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nextHref, previousHref, router]);

  useEffect(() => {
    for (const navigation of [desktopNavigationRef.current, mobileNavigationRef.current]) {
      const active = navigation?.querySelector<HTMLElement>('[aria-current="page"]');
      active?.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [currentPage]);

  return (
    <div className="mt-3 flex h-[min(70svh,720px)] min-h-[320px] flex-col gap-3 xl:min-h-0 xl:flex-1">
      <div className="flex min-h-0 flex-1 gap-4">
        <div ref={hostRef} className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
          {frameSize.width > 0 ? (
            <div
              className="overflow-hidden rounded-xl border border-line bg-card shadow-sm"
              style={{ width: frameSize.width, height: frameSize.height }}
            >
              <StagePreview doc={doc} bindingUrls={bindingUrls} stageMode={stageMode} />
            </div>
          ) : null}
        </div>

        <aside className="hidden w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-card p-3 xl:flex">
          <h2 className="shrink-0 text-sm font-medium text-ink">{pageNavigationLabel}</h2>
          <nav ref={desktopNavigationRef} aria-label={pageNavigationLabel} className="mt-3 min-h-0 overflow-y-auto pr-1">
            <div className="flex flex-col gap-1">
              {pages.map((page) => (
                <Link
                  key={page.pageNo}
                  href={page.href}
                  title={page.label}
                  aria-label={page.label}
                  aria-current={page.pageNo === currentPage ? "page" : undefined}
                  className={cn(
                    "flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-xs transition",
                    page.pageNo === currentPage
                      ? "border-rose bg-rose font-semibold text-white"
                      : "border-line text-muted hover:border-crater hover:bg-moon/40 hover:text-ink",
                  )}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-paper/70 tabular-nums text-ink">
                    {page.pageNo}
                  </span>
                  <span className="truncate">{page.title}</span>
                </Link>
              ))}
            </div>
          </nav>
        </aside>
      </div>

      <nav ref={mobileNavigationRef} aria-label={pageNavigationLabel} className="flex shrink-0 items-center gap-2 overflow-x-auto rounded-lg border border-line bg-card p-2 xl:hidden">
        <span className="sticky left-0 shrink-0 bg-card px-1 text-xs font-medium text-ink">{pageNavigationLabel}</span>
        {pages.map((page) => (
          <Link
            key={page.pageNo}
            href={page.href}
            title={page.label}
            aria-label={page.label}
            aria-current={page.pageNo === currentPage ? "page" : undefined}
            className={cn(
              "flex max-w-48 shrink-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs",
              page.pageNo === currentPage ? "border-rose bg-rose font-semibold text-white" : "border-line text-muted",
            )}
          >
            <span className="tabular-nums">{page.pageNo}</span>
            <span className="truncate">{page.title}</span>
          </Link>
        ))}
      </nav>

      <div className="flex shrink-0 items-center justify-between gap-3">
        {previousHref ? (
          <Link
            href={previousHref}
            aria-keyshortcuts="ArrowLeft"
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            <ArrowLeft size={15} />
            {previousLabel}
          </Link>
        ) : <span />}

        <p className="hidden text-xs text-muted sm:block">
          <kbd className="rounded border border-line bg-card px-1.5 py-0.5 font-sans">←</kbd>
          <span className="px-1">/</span>
          <kbd className="rounded border border-line bg-card px-1.5 py-0.5 font-sans">→</kbd>
          <span className="ml-2">{shortcutHint}</span>
        </p>

        {nextHref ? (
          <Link
            href={nextHref}
            aria-keyshortcuts="ArrowRight"
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            {nextLabel}
            <ArrowRight size={15} />
          </Link>
        ) : <span />}
      </div>
    </div>
  );
}

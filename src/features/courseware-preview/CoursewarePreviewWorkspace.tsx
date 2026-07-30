"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export interface CoursewarePreviewListItem {
  id: string;
  title: string;
  href?: string;
  leading?: ReactNode;
  titleContent?: ReactNode;
  trailing?: ReactNode;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable
    || target.matches("input, textarea, select, button, [role='textbox']");
}

/**
 * Shared courseware viewer: a persistent page rail plus an aspect-correct preview.
 * Callers may add editing/check controls to rail rows, while read-only consumers
 * simply pass titles (and optional hrefs). The preview is fitted to the actual
 * remaining width and height instead of extending the page by its full-width ratio.
 */
export function CoursewarePreviewWorkspace({
  items,
  selectedIndex,
  onSelectedIndexChange,
  directoryLabel,
  previewLabel,
  previousLabel,
  nextLabel,
  keyboardHint,
  selectedPageLabel,
  railStatus,
  railFooter,
  preview,
  previewAspect = 4 / 3,
  railWidth = "standard",
  className,
}: {
  items: CoursewarePreviewListItem[];
  selectedIndex: number;
  onSelectedIndexChange?: (index: number) => void;
  directoryLabel: string;
  previewLabel: string;
  previousLabel: string;
  nextLabel: string;
  keyboardHint: string;
  selectedPageLabel?: string;
  railStatus?: ReactNode;
  railFooter?: ReactNode;
  preview: ReactNode;
  previewAspect?: number;
  railWidth?: "standard" | "wide";
  className?: string;
}) {
  const router = useRouter();
  const previewBodyRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState<number | null>(null);

  useEffect(() => {
    const body = previewBodyRef.current;
    if (!body) return;
    const fit = () => {
      const { width, height } = body.getBoundingClientRect();
      setStageWidth(Math.max(0, Math.floor(Math.min(width, height * previewAspect))));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(body);
    fit();
    return () => observer.disconnect();
  }, [previewAspect]);

  const goTo = useCallback((index: number) => {
    const item = items[index];
    if (!item) return;
    if (item.href) {
      router.push(item.href);
      return;
    }
    onSelectedIndexChange?.(index);
  }, [items, onSelectedIndexChange, router]);

  const goPrevious = useCallback(() => goTo(selectedIndex - 1), [goTo, selectedIndex]);
  const goNext = useCallback(() => goTo(selectedIndex + 1), [goTo, selectedIndex]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) return;
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        if (selectedIndex <= 0) return;
        event.preventDefault();
        goPrevious();
      } else if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        if (selectedIndex >= items.length - 1) return;
        event.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goPrevious, items.length, selectedIndex]);

  const selectByKeyboard = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelectedIndexChange?.(index);
  };

  return (
    <div
      className={cn(
        "grid h-full min-h-0 min-w-0 grid-rows-[minmax(10rem,32%)_minmax(0,1fr)] gap-3 xl:grid-rows-1",
        railWidth === "wide"
          ? "xl:grid-cols-[17rem_minmax(0,1fr)]"
          : "xl:grid-cols-[13rem_minmax(0,1fr)]",
        className,
      )}
      data-courseware-preview-workspace
    >
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-card" data-courseware-page-rail>
        <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted">{directoryLabel}</span>
          {railStatus}
        </div>
        <ol className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
          {items.map((item, index) => {
            const active = selectedIndex === index;
            const content = (
              <>
                <span className="w-5 shrink-0 text-right font-mono text-[11px] text-muted">{index + 1}</span>
                {item.leading}
                <span className="min-w-0 flex-1">{item.titleContent ?? <span className="block truncate text-xs text-ink">{item.title}</span>}</span>
                {item.trailing}
              </>
            );
            const rowClass = cn(
              "group flex min-h-11 items-center gap-1.5 px-2 py-1.5 transition-colors",
              active ? "bg-crater/10" : "bg-line/10 hover:bg-moon/20",
            );
            return (
              <li key={item.id}>
                {item.href ? (
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    title={item.title}
                    className={rowClass}
                  >
                    {content}
                  </Link>
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    aria-current={active ? "page" : undefined}
                    title={item.title}
                    onClick={() => onSelectedIndexChange?.(index)}
                    onKeyDown={(event) => selectByKeyboard(event, index)}
                    className={cn(rowClass, "cursor-pointer")}
                  >
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {railFooter ? <div className="shrink-0 border-t border-line p-1.5">{railFooter}</div> : null}
      </section>

      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-moon/10" data-courseware-preview>
        <div className="flex min-h-10 shrink-0 items-center justify-between border-b border-line px-3 py-2">
          <span className="text-xs font-medium text-muted">{previewLabel}</span>
          {selectedPageLabel ? <span className="min-w-0 truncate pl-4 text-xs text-muted">{selectedPageLabel}</span> : null}
        </div>
        <div ref={previewBodyRef} className="flex min-h-0 flex-1 items-start justify-center overflow-hidden">
          <div
            className="shrink-0 overflow-hidden bg-card"
            data-courseware-preview-stage
            style={{
              width: stageWidth === null ? "100%" : stageWidth,
              aspectRatio: String(previewAspect),
            }}
          >
            {preview}
          </div>
        </div>
        <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-t border-line px-2 py-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={selectedIndex <= 0}
            aria-keyshortcuts="ArrowLeft PageUp"
            onClick={goPrevious}
          >
            <ChevronLeft size={15} />
            {previousLabel}
          </Button>
          <span className="hidden min-w-0 truncate text-center text-[11px] text-muted sm:block">{keyboardHint}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={selectedIndex >= items.length - 1}
            aria-keyshortcuts="ArrowRight PageDown Space"
            onClick={goNext}
          >
            {nextLabel}
            <ChevronRight size={15} />
          </Button>
        </div>
      </section>
    </div>
  );
}

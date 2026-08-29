"use client";

import { ChevronLeft, ChevronRight, ListOrdered, ListTodo, MoreHorizontal, PenLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { CoursewarePage } from "../types";
import { OPTION_LABELS } from "./liveState";
import { ToolPicker } from "./LivePanels";

export function ClassroomPageControls({
  pages,
  currentPage,
  largeTargets = false,
  rail = false,
  onGoto,
}: {
  pages: readonly CoursewarePage[];
  currentPage: number;
  largeTargets?: boolean;
  rail?: boolean;
  onGoto: (page: number) => void;
}) {
  const t = useTranslations("classroom.live");
  const targetClass = largeTargets ? "min-h-11" : "min-h-10";
  const roundClass = largeTargets ? "size-11" : "size-10";
  const pageListLabel = t("pageListPosition", {
    current: pages.length === 0 ? 0 : currentPage + 1,
    total: pages.length,
  });

  return (
    <div
      className={cn(
        "flex min-w-0 items-center justify-end",
        rail ? "gap-0.5" : "gap-1.5",
      )}
      data-classroom-rail-group={rail ? "pages" : undefined}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              rail
                ? "grid size-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-moon/30 hover:text-ink"
                : "inline-flex items-center gap-1.5 rounded-full border border-line px-3 text-xs text-muted transition-colors hover:bg-moon/30 hover:text-ink",
              !rail && targetClass,
            )}
            title={pageListLabel}
            data-classroom-rail-button={rail ? "page-list" : undefined}
          >
            <ListOrdered size={rail ? 19 : 15} />
            <span className={rail ? "sr-only" : undefined}>{rail ? pageListLabel : t("pageList")}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-72 p-2">
          <p className="px-2 pb-2 text-xs font-medium text-muted">{t("pageList")}</p>
          <ol className="max-h-72 space-y-1 overflow-y-auto">
            {pages.map((page, pageIndex) => (
              <li key={page.id}>
                <button
                  type="button"
                  onClick={() => onGoto(pageIndex)}
                  aria-current={pageIndex === currentPage ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors",
                    targetClass,
                    pageIndex === currentPage ? "bg-moon/50 text-ink" : "text-muted hover:bg-moon/30 hover:text-ink",
                  )}
                >
                  <span className="w-6 shrink-0 text-right font-mono text-xs">{pageIndex + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{page.title || t("untitledPage")}</span>
                </button>
              </li>
            ))}
          </ol>
        </PopoverContent>
      </Popover>
      <button
        type="button"
        aria-label={t("prevPage")}
        disabled={currentPage <= 0}
        onClick={() => onGoto(currentPage - 1)}
        className={cn(
          "grid shrink-0 place-items-center rounded-full text-ink transition-colors hover:bg-moon/30 disabled:opacity-30",
          !rail && "border border-line",
          roundClass,
        )}
        title={t("prevPage")}
        data-classroom-rail-button={rail ? "previous-page" : undefined}
      >
        <ChevronLeft size={18} />
      </button>
      <button
        type="button"
        aria-label={t("nextPage")}
        disabled={currentPage >= pages.length - 1}
        onClick={() => onGoto(currentPage + 1)}
        className={cn(
          "grid shrink-0 place-items-center rounded-full text-ink transition-colors hover:bg-moon/30 disabled:opacity-30",
          !rail && "border border-line",
          roundClass,
        )}
        title={t("nextPage")}
        data-classroom-rail-button={rail ? "next-page" : undefined}
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

export function ClassroomToolsMenu({
  open,
  quizOpen,
  largeTarget = false,
  rail = false,
  align = "end",
  onOpenChange,
  onInsertBoard,
  onOpenTool,
  onOpenQuiz,
}: {
  open: boolean;
  quizOpen: boolean;
  largeTarget?: boolean;
  rail?: boolean;
  align?: "start" | "end";
  onOpenChange: (open: boolean) => void;
  onInsertBoard: () => void;
  onOpenTool: (toolId: string) => void;
  onOpenQuiz: (options: number) => void;
}) {
  const t = useTranslations("classroom.live");

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            rail
              ? "grid size-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-moon/30 hover:text-ink"
              : "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3 text-xs text-muted transition-colors hover:bg-moon/30 hover:text-ink",
            !rail && (largeTarget ? "min-h-11" : "min-h-10"),
          )}
          title={t("moreClassroomTools")}
          data-classroom-rail-button={rail ? "more" : undefined}
        >
          <MoreHorizontal size={rail ? 18 : 14} />
          <span className={rail ? "sr-only" : undefined}>{t("moreClassroomTools")}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align={align} className="w-64 p-2">
        <Button type="button" size="sm" variant="ghost" className="w-full justify-start" onClick={onInsertBoard}>
          <PenLine size={15} />
          {t("insertBoard")}
        </Button>
        <div aria-hidden className="my-2 h-px bg-line" />
        <p className="px-2 pb-1 text-xs font-medium text-muted">{t("openTool")}</p>
        <ToolPicker onPick={onOpenTool} />
        {!quizOpen && (
          <>
            <div aria-hidden className="my-2 h-px bg-line" />
            <p className="px-2 pb-1 text-xs font-medium text-muted">{t("quizOpen")}</p>
            <div className="flex items-center gap-1 px-1">
              {[2, 3, 4].map((options) => (
                <Button key={options} type="button" size="sm" variant="ghost" onClick={() => onOpenQuiz(options)}>
                  <ListTodo size={14} />
                  {t("quizOptions", { last: OPTION_LABELS[options - 1] })}
                </Button>
              ))}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

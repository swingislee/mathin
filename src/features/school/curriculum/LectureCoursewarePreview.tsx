import { ChevronLeft, ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import type { CoursewareLecturePreview } from "@/features/courseware-studio/data";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { PreviewKeyboardNavigation } from "./PreviewKeyboardNavigation";

/**
 * 课件预览 + 翻页，独立成组件是为了同一份实现能同时用在两处：讲次工作区
 * 页面内嵌（无外壳）和 `LecturePreviewPanel` 弹窗正文（带外壳）。
 * `prevHref`/`nextHref` 由调用方按各自的 baseHref 拼好传入，为 `null`
 * 时对应方向不渲染链接（不做置灰按钮）。
 */
export async function LectureCoursewarePreview({
  preview,
  prevHref,
  nextHref,
  pageHrefs,
}: {
  preview: CoursewareLecturePreview;
  prevHref: string | null;
  nextHref: string | null;
  pageHrefs: string[];
}) {
  const t = await getTranslations("school.courses");
  const track = preview.page.aspect === "4:3" ? "adapted-4x3" : "native-16x9";

  return (
    <div className="grid min-h-0 gap-3 md:grid-cols-[12rem_minmax(0,1fr)]">
      <aside className="hidden min-h-0 rounded-xl bg-card/55 p-2 ring-1 ring-line/45 md:flex md:flex-col">
        <p className="px-2 py-1 text-xs font-medium text-muted">{t("previewDirectory")}</p>
        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto" aria-label={t("previewDirectory")}>
          {preview.pages.map((page, index) => (
            <Link
              key={page.pageDocId}
              href={pageHrefs[index]!}
              aria-current={index + 1 === preview.pageIndex ? "page" : undefined}
              className={cn("block truncate rounded-lg px-2 py-1.5 text-xs transition", index + 1 === preview.pageIndex ? "bg-ink font-medium text-paper" : "text-muted hover:bg-paper/80 hover:text-ink")}
            >
              {page.pageNo}. {page.title || t("previewUntitledPage")}
            </Link>
          ))}
        </nav>
        <p className="px-2 pt-2 text-[11px] text-muted">{t("previewKeyboardHint")}</p>
      </aside>
      <div className="flex min-w-0 flex-col gap-3">
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-paper">
        <StagePreview doc={preview.page.doc} bindingUrls={preview.bindingUrls} stageMode={track === "adapted-4x3" ? "board43" : "natural"} />
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3">
        {prevHref ? (
          <Link href={prevHref} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
            <ChevronLeft className="size-4" />{t("previousPage")}
          </Link>
        ) : <span />}
        <span className="text-sm text-muted">{t("previewPageIndicator", { current: preview.pageIndex, total: preview.pages.length })}</span>
        {nextHref ? (
          <Link href={nextHref} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
            {t("nextPage")}<ChevronRight className="size-4" />
          </Link>
        ) : <span />}
      </div>
    </div>
      <PreviewKeyboardNavigation previousHref={prevHref} nextHref={nextHref} />
    </div>
  );
}

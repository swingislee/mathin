import { ChevronLeft, ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import type { CoursewareLecturePreview } from "@/features/courseware-studio/data";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

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
}: {
  preview: CoursewareLecturePreview;
  prevHref: string | null;
  nextHref: string | null;
}) {
  const t = await getTranslations("school.courses");
  const track = preview.page.aspect === "4:3" ? "adapted-4x3" : "native-16x9";

  return (
    <div className="flex flex-col gap-3">
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
  );
}

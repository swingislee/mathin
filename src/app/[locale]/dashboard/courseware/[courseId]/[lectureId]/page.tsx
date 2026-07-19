import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { COURSEWARE_STUDIO_PERMS, loadLecturePreview } from "@/features/courseware-studio/data";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import { Link } from "@/i18n/navigation";
import { requireAnyPerm } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * 讲次只读预览(P6-4):渲染 current release 快照。服务端每次只下发当前页的
 * doc 与该页用到的 URL,翻页/舞台切换走 searchParams——69 页 doc 全量进
 * 客户端会白发数 MB,违背客户端边界铁律。
 */
export default async function CoursewarePreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; courseId: string; lectureId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, courseId, lectureId }, rawSearchParams] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  await requireAnyPerm(locale, COURSEWARE_STUDIO_PERMS);
  const t = await getTranslations("coursewareStudio");
  const pageParam = Number(Array.isArray(rawSearchParams.page) ? rawSearchParams.page[0] : rawSearchParams.page);
  const preview = await loadLecturePreview(lectureId, pageParam);
  if (!preview || preview.lecture.courseId !== courseId) notFound();

  const pageIndex = preview.pageIndex;
  const stageMode = rawSearchParams.stage === "board43" ? "board43" : "natural";
  const page = preview.page;

  const href = (nextPage: number, nextStage: string) => {
    const query = new URLSearchParams();
    if (nextPage > 1) query.set("page", String(nextPage));
    if (nextStage !== "natural") query.set("stage", nextStage);
    const qs = query.toString();
    return `/dashboard/courseware/${courseId}/${lectureId}${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">
            {t("lectureTitle", { no: preview.lecture.no, name: preview.lecture.name })}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {t("releaseNo", { no: preview.release.releaseNo })} · {t("pageIndicator", { current: pageIndex, total: preview.pages.length })}
            {page.title ? ` · ${page.title}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={href(pageIndex, "natural")}
            className={cn(buttonVariants({ variant: stageMode === "natural" ? "primary" : "secondary", size: "sm" }))}
          >
            {t("stageNatural")}
          </Link>
          <Link
            href={href(pageIndex, "board43")}
            className={cn(buttonVariants({ variant: stageMode === "board43" ? "primary" : "secondary", size: "sm" }))}
          >
            {t("stageBoard")}
          </Link>
        </div>
      </div>
      <p className="mt-3">
        <Link
          href={`/dashboard/courseware/${courseId}`}
          className="text-xs text-muted underline underline-offset-2 hover:text-ink"
        >
          {t("backToLectures")}
        </Link>
      </p>

      <div className="mt-5 overflow-hidden rounded-xl border border-line bg-card">
        <StagePreview doc={page.doc} bindingUrls={preview.bindingUrls} stageMode={stageMode} />
      </div>

      <div className="mt-5 flex items-center justify-between">
        {pageIndex > 1 ? (
          <Link href={href(pageIndex - 1, stageMode)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
            {t("prevPage")}
          </Link>
        ) : (
          <span />
        )}
        {pageIndex < preview.pages.length ? (
          <Link href={href(pageIndex + 1, stageMode)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
            {t("nextPage")}
          </Link>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}

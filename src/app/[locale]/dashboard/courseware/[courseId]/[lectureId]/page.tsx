import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { COURSEWARE_STUDIO_PERMS, loadLecturePreview, parseCoursewareTrack } from "@/features/courseware-studio/data";
import { CoursewareReviewViewport } from "@/features/courseware-studio/CoursewareReviewViewport";
import { Link } from "@/i18n/navigation";
import { requireAnyPerm } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * 讲次只读预览(P6-4):渲染 current release 快照。服务端每次只下发当前页的
 * doc 与该页用到的 URL,翻页/版本切换走 searchParams——69 页 doc 全量进
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
  const track = parseCoursewareTrack(rawSearchParams.track);
  const preview = await loadLecturePreview(lectureId, track, pageParam);
  if (!preview || preview.lecture.courseId !== courseId) notFound();

  const pageIndex = preview.pageIndex;
  const stageMode = track === "adapted-4x3" ? "board43" : "natural";
  const page = preview.page;

  const href = (nextPage: number, nextTrack = track) => {
    const query = new URLSearchParams();
    if (nextPage > 1) query.set("page", String(nextPage));
    query.set("track", nextTrack);
    const qs = query.toString();
    return `/dashboard/courseware/${courseId}/${lectureId}${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col xl:h-full xl:min-h-0">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">
            {t("lectureTitle", { no: preview.lecture.no, name: preview.lecture.name })}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {t("releaseNo", { no: preview.release.releaseNo })} · {t("pageIndicator", { current: pageIndex, total: preview.pages.length })}
            {page.title ? ` · ${page.title}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/dashboard/courseware/${courseId}/${lectureId}/${page.pageDocId}?track=${track}`}
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            {t("editPage")}
          </Link>
          <div role="group" aria-label={t("reviewVersion")} className="flex rounded-full border border-line bg-muted/30 p-1">
            <Link
              href={href(pageIndex, "native-16x9")}
              aria-current={track === "native-16x9" ? "page" : undefined}
              className={cn("rounded-full px-3 py-1.5 text-sm transition", track === "native-16x9" ? "bg-card font-medium text-ink shadow-sm" : "text-muted hover:text-ink")}
            >
              {t("trackNative")}
            </Link>
            <Link
              href={href(pageIndex, "adapted-4x3")}
              aria-current={track === "adapted-4x3" ? "page" : undefined}
              className={cn("rounded-full px-3 py-1.5 text-sm transition", track === "adapted-4x3" ? "bg-card font-medium text-ink shadow-sm" : "text-muted hover:text-ink")}
            >
              {t("trackAdapted")}
            </Link>
          </div>
        </div>
      </div>
      <p className="mt-2 shrink-0">
        <Link
          href={`/dashboard/courseware/${courseId}`}
          className="text-xs text-muted underline underline-offset-2 hover:text-ink"
        >
          {t("backToLectures")}
        </Link>
      </p>

      <CoursewareReviewViewport
        doc={page.doc}
        bindingUrls={preview.bindingUrls}
        stageMode={stageMode}
        previousHref={pageIndex > 1 ? href(pageIndex - 1) : null}
        nextHref={pageIndex < preview.pages.length ? href(pageIndex + 1) : null}
        previousLabel={t("prevPage")}
        nextLabel={t("nextPage")}
        shortcutHint={t("keyboardPagingHint")}
        pageNavigationLabel={t("pageNavigation")}
        pages={preview.pages.map((item, index) => ({
          pageNo: item.pageNo,
          title: item.title || t("untitledPage"),
          href: href(index + 1),
          label: t("jumpToPage", { page: item.pageNo, title: item.title || t("untitledPage") }),
        }))}
        currentPage={page.pageNo}
      />
    </div>
  );
}

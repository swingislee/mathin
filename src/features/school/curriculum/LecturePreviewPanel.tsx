import { ExternalLink } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import type { CoursewareLecturePreview, CoursewareTrack } from "@/features/courseware-studio/data";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { LectureCoursewarePreview } from "./LectureCoursewarePreview";

/** `baseHref` 已经带着调用页面自己的 `?...` 查询串,拼接时只用 `&`(对齐历史版本约定)。 */
function previewHref(baseHref: string, lectureId: string, page: number, track: CoursewareTrack) {
  const query = new URLSearchParams();
  query.set("lecture", lectureId);
  if (page > 1) query.set("page", String(page));
  query.set("track", track);
  return `${baseHref}&${query.toString()}`;
}

/**
 * 讲次预览对话框正文（doc19 历史设计,P4I-11 曾删除又被要求复原并组件化）。
 * 唯一可复用的"预览讲次"实现——课程产品页教学计划、研发任务页任务队列
 * 都通过 `?lecture=&page=&track=` 查询参数触发同一个组件,不是各写一份。
 * 只负责"看一眼"：翻页、切轨道都在这一页内完成,深入编辑走 `workspaceHref`
 * 进讲次工作区整页(工作区自己的主动作再决定要不要进 Studio)。
 */
export async function LecturePreviewPanel({
  preview,
  baseHref,
  workspaceHref,
}: {
  preview: CoursewareLecturePreview;
  baseHref: string;
  workspaceHref: string;
}) {
  const t = await getTranslations("school.courses");
  const currentTrack: CoursewareTrack = preview.page.aspect === "4:3" ? "adapted-4x3" : "native-16x9";
  const prevHref = preview.pageIndex > 1 ? previewHref(baseHref, preview.lecture.id, preview.pageIndex - 1, currentTrack) : null;
  const nextHref = preview.pageIndex < preview.pages.length ? previewHref(baseHref, preview.lecture.id, preview.pageIndex + 1, currentTrack) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-6 py-5 pr-14">
        <h2 className="font-display text-lg text-ink">{t("lecturePreviewTitle", { no: preview.lecture.no, name: preview.lecture.name })}</h2>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3">
        <div className="flex rounded-full border border-line bg-paper p-1" role="group" aria-label={t("coursewareTrack")}>
          <Link href={previewHref(baseHref, preview.lecture.id, preview.pageIndex, "native-16x9")} className={cn(buttonVariants({ size: "sm", variant: currentTrack === "native-16x9" ? "primary" : "ghost" }), "rounded-full")}>{t("trackNative")}</Link>
          <Link href={previewHref(baseHref, preview.lecture.id, preview.pageIndex, "adapted-4x3")} className={cn(buttonVariants({ size: "sm", variant: currentTrack === "adapted-4x3" ? "primary" : "ghost" }), "rounded-full")}>{t("trackAdapted")}</Link>
        </div>
        <Link href={workspaceHref} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("openLecture")}<ExternalLink className="size-4" /></Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-paper px-3 py-4 sm:px-6">
        <LectureCoursewarePreview preview={preview} prevHref={prevHref} nextHref={nextHref} />
      </div>
    </div>
  );
}

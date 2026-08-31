import { getTranslations } from "next-intl/server";
import type { CoursewareLecturePreview, CoursewareTrack } from "@/features/courseware-studio/data";
import { LectureCoursewarePreview } from "./LectureCoursewarePreview";
import { LecturePreviewTrackSwitcher } from "./LecturePreviewTrackSwitcher";
import { OpenCoursewareWorkspaceButton } from "./OpenCoursewareWorkspaceButton";

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
 * 只负责"看一眼"：翻页、切轨道都在这一页内完成；深入处理从当前页面
 * 直接进入统一课件工作区，不再先打开讲次工作区再二次进入 Studio。
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
  const [t, workspaceT] = await Promise.all([
    getTranslations("school.courses"),
    getTranslations("coursewareWorkspace"),
  ]);
  const currentTrack = preview.track;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-6 py-5 pr-14">
        <h2 className="font-display text-lg text-ink">{t("lecturePreviewTitle", { no: preview.lecture.no, name: preview.lecture.name })}</h2>
      </div>
      <div className="mx-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-card/55 px-3 py-2 ring-1 ring-line/45 sm:mx-6">
        <LecturePreviewTrackSwitcher
          baseHref={baseHref}
          lectureId={preview.lecture.id}
          currentTrack={currentTrack}
          initialPage={preview.pageIndex}
        />
        <OpenCoursewareWorkspaceButton href={workspaceHref} label={workspaceT("openWorkspace")} />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-paper px-3 py-4 sm:px-6">
        <LectureCoursewarePreview
          preview={preview}
          fillAvailable
          pageHrefs={preview.pages.map((_, index) => previewHref(baseHref, preview.lecture.id, index + 1, currentTrack))}
        />
      </div>
    </div>
  );
}

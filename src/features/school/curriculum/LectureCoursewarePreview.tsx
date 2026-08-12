import { getTranslations } from "next-intl/server";
import { CoursewarePreviewWorkspace } from "@/features/courseware-preview/CoursewarePreviewWorkspace";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import type { CoursewareLecturePreview } from "@/features/courseware-studio/data";
import { isSpatialPageDoc } from "@/features/courseware-doc/spatial";
import { cn } from "@/lib/utils";

/**
 * 课件预览 + 翻页，独立成组件是为了同一份实现能同时用在两处：讲次工作区
 * 页面内嵌（无外壳）和 `LecturePreviewPanel` 弹窗正文（带外壳）。
 * 每页 href 由调用方按各自的 baseHref 拼好；共享预览组件据当前索引统一驱动
 * 目录、上一页/下一页按钮和键盘快捷键。
 */
export async function LectureCoursewarePreview({
  preview,
  pageHrefs,
  fillAvailable = false,
}: {
  preview: CoursewareLecturePreview;
  pageHrefs: string[];
  fillAvailable?: boolean;
}) {
  const t = await getTranslations("school.courses");
  const isFourThree = preview.page.aspect === "4:3";
  const previewAspect = isFourThree
    ? 4 / 3
    : isSpatialPageDoc(preview.page.doc)
      ? 16 / 9
      : preview.page.doc.canvas.width / preview.page.doc.canvas.height;

  return (
    <div className={cn("flex min-h-0 flex-col", fillAvailable ? "h-full" : "h-[min(70dvh,44rem)] min-h-[28rem]")}>
      <CoursewarePreviewWorkspace
        className="flex-1"
        items={preview.pages.map((page, index) => ({
          id: page.pageDocId,
          title: `${page.pageNo}. ${page.title || t("previewUntitledPage")}`,
          href: pageHrefs[index]!,
        }))}
        selectedIndex={preview.pageIndex - 1}
        directoryLabel={t("previewDirectory")}
        previewLabel={t("coursewarePreview")}
        previousLabel={t("previousPage")}
        nextLabel={t("nextPage")}
        keyboardHint={t("previewKeyboardHint")}
        selectedPageLabel={t("previewPageIndicator", { current: preview.pageIndex, total: preview.pages.length })}
        previewAspect={previewAspect}
        preview={(
          <StagePreview
            doc={preview.page.doc}
            bindingUrls={preview.bindingUrls}
            stageMode={isFourThree ? "board43" : "natural"}
            className="size-full"
          />
        )}
      />
    </div>
  );
}

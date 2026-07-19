import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { CoursewarePageEditor } from "@/features/courseware-studio/CoursewarePageEditor";
import { loadCoursewareStudioPage } from "@/features/courseware-studio/data";
import { requirePerm } from "@/lib/auth";

/** P6-7 页编辑器：壳保持 Server Component，舞台是动态 client 叶子。 */
export default async function CoursewarePageEditorRoute({
  params,
}: {
  params: Promise<{ locale: string; courseId: string; lectureId: string; pageId: string }>;
}) {
  const { locale, courseId, lectureId, pageId } = await params;
  setRequestLocale(locale);
  // P6-7 是实际写入页面；只读预览仍可保留任一 courseware.* 权限，
  // 编辑器入口必须先过 page.edit，不能靠按钮内的 action 再兜底。
  await requirePerm(locale, "courseware.page.edit");
  const data = await loadCoursewareStudioPage(lectureId, pageId);
  if (!data || data.lecture.courseId !== courseId) notFound();
  return (
    <CoursewarePageEditor
      lecture={data.lecture}
      page={data.page}
      pages={data.pages}
      initialDoc={data.activeRevision.doc}
      baseRevisionNo={data.activeRevision.revisionNo}
      revisions={data.revisions}
      releases={data.releaseHistory}
      bindingUrls={data.bindingUrls}
      imageAssetUsage={data.imageAssetUsage}
      copyTargets={data.copyTargets}
    />
  );
}

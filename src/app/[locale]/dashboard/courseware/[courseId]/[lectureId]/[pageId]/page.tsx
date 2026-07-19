import { notFound, permanentRedirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { loadCoursewareWorkbenchContext, parseCoursewareTrack } from "@/features/courseware-studio/data";
import { requirePerm } from "@/lib/auth";

/** P4H-6 compatibility shell: an old page editor URL cannot revive a second editor. */
export default async function LegacyCoursewarePageEditorRoute({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; courseId: string; lectureId: string; pageId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, courseId, lectureId, pageId }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  await requirePerm(locale, "courseware.page.edit");
  const context = await loadCoursewareWorkbenchContext(lectureId);
  if (!context || context.course.id !== courseId) notFound();
  const track = parseCoursewareTrack(query.track);
  permanentRedirect(`/dashboard/courseware/lectures/${lectureId}?mode=edit&page=${pageId}&track=${track}`);
}

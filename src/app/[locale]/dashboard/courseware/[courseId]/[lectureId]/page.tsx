import { notFound, permanentRedirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { COURSEWARE_STUDIO_PERMS, loadCoursewareWorkbenchContext, parseCoursewareTrack } from "@/features/courseware-studio/data";
import { requireAnyPerm } from "@/lib/auth";

/** P4H-6 compatibility shell: the former preview route now points at the one workbench. */
export default async function LegacyCoursewarePreviewRoute({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; courseId: string; lectureId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, courseId, lectureId }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  await requireAnyPerm(locale, COURSEWARE_STUDIO_PERMS);
  const context = await loadCoursewareWorkbenchContext(lectureId);
  if (!context || context.course.id !== courseId) notFound();
  const track = parseCoursewareTrack(query.track);
  permanentRedirect(`/dashboard/courseware/lectures/${lectureId}?track=${track}`);
}

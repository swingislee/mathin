import { notFound, permanentRedirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { COURSEWARE_STUDIO_PERMS, loadCoursewareWorkbenchContext } from "@/features/courseware-studio/data";
import { requireAnyPerm } from "@/lib/auth";

/** P4H-6 compatibility shell: the retired template editor no longer renders or writes courseware_template. */
export default async function LegacyCourseTemplateRoute({
  params,
}: {
  params: Promise<{ locale: string; id: string; lectureId: string }>;
}) {
  const { locale, id, lectureId } = await params;
  setRequestLocale(locale);
  await requireAnyPerm(locale, COURSEWARE_STUDIO_PERMS);
  const context = await loadCoursewareWorkbenchContext(lectureId);
  if (!context || context.course.id !== id) notFound();
  permanentRedirect(`/dashboard/curriculum/lectures/${lectureId}`);
}

import { notFound, permanentRedirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { COURSEWARE_STUDIO_PERMS } from "@/features/courseware-studio/data";
import { findCourseFamilyForLegacyVariant } from "@/features/school/teaching-operations/course-family-detail";
import { requireAnyPerm } from "@/lib/auth";

/** P4H-6 compatibility shell: the former courseware course directory has no UI or write path. */
export default async function LegacyCoursewareCourseRoute({
  params,
}: {
  params: Promise<{ locale: string; courseId: string }>;
}) {
  const { locale, courseId } = await params;
  setRequestLocale(locale);
  await requireAnyPerm(locale, COURSEWARE_STUDIO_PERMS);
  const familyId = await findCourseFamilyForLegacyVariant(courseId);
  if (!familyId) notFound();
  permanentRedirect(`/dashboard/courses/${familyId}?variant=${courseId}&scope=research`);
}

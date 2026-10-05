import { setRequestLocale } from "next-intl/server";
import { requireAnyPerm } from "@/lib/auth";
import { loadParentCourseAdmissions } from "@/features/school/parent-course-admissions";
import { ParentCourseAdmissions } from "@/features/school/ParentCourseAdmissions";

export default async function AdmissionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAnyPerm(locale, ["course.manage", "enrollment.manage"]);
  return <ParentCourseAdmissions value={await loadParentCourseAdmissions()} />;
}

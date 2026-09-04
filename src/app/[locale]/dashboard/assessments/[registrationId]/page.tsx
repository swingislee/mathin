import { setRequestLocale } from "next-intl/server";
import { TeacherAssessmentWorkbench } from "@/features/school/TeacherAssessmentWorkbench";
import { getTeacherAssessmentWorkbenchData } from "@/features/school/teacher-assessment-data";
import { requireAnyPerm } from "@/lib/auth";

export default async function TeacherAssessmentPage({
  params,
}: {
  params: Promise<{ locale: string; registrationId: string }>;
}) {
  const { locale, registrationId } = await params;
  setRequestLocale(locale);
  await requireAnyPerm(locale, ["review.write"]);
  const data = await getTeacherAssessmentWorkbenchData(registrationId);
  return <TeacherAssessmentWorkbench data={data} />;
}

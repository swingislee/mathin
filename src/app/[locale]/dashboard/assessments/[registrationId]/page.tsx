import { setRequestLocale } from "next-intl/server";
import { TeacherAssessmentWorkbench } from "@/features/school/TeacherAssessmentWorkbench";
import { getTeacherAssessmentWorkbenchData } from "@/features/school/teacher-assessment-data";
import { requireAnyPerm } from "@/lib/auth";
import { readAssessmentWorkflow } from "@/features/school/assessment-workflow-data";

export default async function TeacherAssessmentPage({
  params,
}: {
  params: Promise<{ locale: string; registrationId: string }>;
}) {
  const { locale, registrationId } = await params;
  setRequestLocale(locale);
  await requireAnyPerm(locale, ["review.write"]);
  const [data, workflow] = await Promise.all([getTeacherAssessmentWorkbenchData(registrationId), readAssessmentWorkflow(registrationId)]);
  return <TeacherAssessmentWorkbench data={data} readOnly={Boolean(workflow?.finalizedAt)} />;
}

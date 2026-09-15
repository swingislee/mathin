import { Suspense } from "react";
import { createHash } from "node:crypto";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAnyPerm } from "@/lib/auth";
import { DashboardBackLink, DashboardPage } from "@/features/school/dashboard-page";
import { getAssignmentQuestionWorkbook } from "@/features/school/assignment-question-read";
import { AssignmentQuestionWorkbench } from "@/features/school/AssignmentQuestionWorkbench";
import { TEACHING_WORKBENCH_PERMISSIONS } from "@/features/school/teaching-workbench/teaching-workbench-access";

export default async function AssignmentQuestionsPage({ params }: { params: Promise<{ locale: string; assignmentId: string }> }) {
  const { locale, assignmentId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("school.homeworkQuestions");
  return <Suspense fallback={<DashboardPage title={t("title")}><p role="status">{t("loading")}</p></DashboardPage>}>
    <Content locale={locale} assignmentId={assignmentId} />
  </Suspense>;
}

async function Content({ locale, assignmentId }: { locale: string; assignmentId: string }) {
  await requireAnyPerm(locale, TEACHING_WORKBENCH_PERMISSIONS);
  const t = await getTranslations("school.homeworkQuestions");
  let data;
  try { data = await getAssignmentQuestionWorkbook(assignmentId); }
  catch { return <DashboardPage title={t("title")}><p role="alert">{t("loadFailed")}</p></DashboardPage>; }
  const version = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  return <DashboardPage title={data.assignment.title} description={`${data.assignment.classroomName} · ${t("title")}`} density="compact">
    <DashboardBackLink href={data.assignment.sessionId ? `/dashboard/sessions/${data.assignment.sessionId}?stage=post` : "/dashboard/teaching"} label={t("back")} />
    <AssignmentQuestionWorkbench key={`${data.questions.length}:${version}`} initial={data} />
  </DashboardPage>;
}

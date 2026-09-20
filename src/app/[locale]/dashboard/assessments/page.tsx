import { getNow, getTranslations, setRequestLocale } from "next-intl/server";
import { AssessmentPagedWorkbench } from "@/features/school/AssessmentPagedWorkbench";
import { listAssessmentWorkbenchRows } from "@/features/school/assessment-workbench-data";
import { listAssessmentAssessorOptions } from "@/features/school/invitations";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { getOrganizationTimezoneV2 } from "@/features/school/organization-locations";
import { assessmentPageStage, assessmentWorkbenchFieldPage, type AssessmentPageQuery } from "@/features/school/assessment-workbench-page";
import { assessmentTableFields } from "@/features/school/assessment-table-fields";

export default async function AssessmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<AssessmentPageQuery>;
}) {
  const { locale } = await params;
  const query=await searchParams;
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ["review.write", "followup.view"]);
  const permissions = await getMyPerms(user.id);
  const canAssess = permissions.has("review.write");
  const canSupport = permissions.has("followup.view");
  const canManageAssessor = permissions.has("followup.write");
  const [rows, assessors, timeZone, now, tableT, assessmentT, t, teacherT, quickT] = await Promise.all([
    listAssessmentWorkbenchRows(),
    listAssessmentAssessorOptions(),
    getOrganizationTimezoneV2(),
    getNow(),
    getTranslations("school.table"), getTranslations("school.assessments"), getTranslations("school.supportAssessment"),
    getTranslations("school.teacherAssessment"), getTranslations("school.assessmentQuickEntry"),
  ]);
  const fields = assessmentTableFields({ locale, timeZone, tableT, assessmentT, t, teacherT, quickT, stageFor: assessmentPageStage });
  const data = assessmentWorkbenchFieldPage(rows, fields, query, { locale, timeZone, now: now.getTime() });

  return (
    <AssessmentPagedWorkbench
      data={data}
      assessors={assessors}
      locale={locale}
      timeZone={timeZone}
      now={now.getTime()}
      canAssess={canAssess}
      canSupport={canSupport}
      canManageAssessor={canManageAssessor}
      canQuickEntry={canAssess || permissions.has("followup.write")}
    />
  );
}

import { setRequestLocale } from "next-intl/server";
import { AssessmentUnifiedWorkbench } from "@/features/school/AssessmentUnifiedWorkbench";
import { listAssessmentWorkbenchRows } from "@/features/school/assessment-workbench-data";
import { listInvitationOptions } from "@/features/school/invitations";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";

export default async function AssessmentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ["review.write", "followup.view"]);
  const permissions = await getMyPerms(user.id);
  const canAssess = permissions.has("review.write");
  const canSupport = permissions.has("followup.view");
  const canManageAssessor = permissions.has("followup.write");
  const [rows, options] = await Promise.all([
    listAssessmentWorkbenchRows(),
    listInvitationOptions(),
  ]);

  return (
    <AssessmentUnifiedWorkbench
      initialRows={rows}
      assessors={options.assessors}
      locale={locale}
      canAssess={canAssess}
      canSupport={canSupport}
      canManageAssessor={canManageAssessor}
    />
  );
}

import { getNow, setRequestLocale } from "next-intl/server";
import { AssessmentUnifiedWorkbench } from "@/features/school/AssessmentUnifiedWorkbench";
import { listAssessmentWorkbenchRows } from "@/features/school/assessment-workbench-data";
import { listInvitationOptions } from "@/features/school/invitations";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { getOrganizationTimezoneV2 } from "@/features/school/organization-locations";

export default async function AssessmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{q?:string;state?:string}>;
}) {
  const { locale } = await params;
  const query=await searchParams;
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ["review.write", "followup.view"]);
  const permissions = await getMyPerms(user.id);
  const canAssess = permissions.has("review.write");
  const canSupport = permissions.has("followup.view");
  const canManageAssessor = permissions.has("followup.write");
  const [rows, options, timeZone, now] = await Promise.all([
    listAssessmentWorkbenchRows(),
    listInvitationOptions(),
    getOrganizationTimezoneV2(),
    getNow(),
  ]);

  return (
    <AssessmentUnifiedWorkbench
      initialRows={rows}
      initialQuery={query.q?.slice(0,100)}
      assessors={options.assessors}
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

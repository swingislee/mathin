import { setRequestLocale } from "next-intl/server";
import { AssessmentUnifiedWorkbench } from "@/features/school/AssessmentUnifiedWorkbench";
import { listAssessmentWorkbenchRows } from "@/features/school/assessment-workbench-data";
import { listInvitationOptions } from "@/features/school/invitations";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { businessRecordStateFilter } from '@/features/school/business-record-state-contract';

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
  const [rows, options] = await Promise.all([
    listAssessmentWorkbenchRows(),
    listInvitationOptions(),
  ]);

  return (
    <AssessmentUnifiedWorkbench
      initialRows={rows}
      initialQuery={query.q?.slice(0,100)}
      initialRecordState={businessRecordStateFilter(query.state)}
      assessors={options.assessors}
      locale={locale}
      canAssess={canAssess}
      canSupport={canSupport}
      canManageAssessor={canManageAssessor}
    />
  );
}

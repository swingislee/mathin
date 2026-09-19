import { Suspense } from "react";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { RenewalOpportunityDetail } from "@/features/school/RenewalOpportunityDetail";
import { loadRenewalWorkspace, scopedRenewalStaffOptions } from "@/features/school/renewals";
import { listStaffMembers } from "@/features/school/staff";
import { getMyPerms, requirePerm } from "@/lib/auth";

export default async function RenewalOpportunityPage({
  params,
}: {
  params: Promise<{ locale: string; opportunityId: string }>;
}) {
  const { locale, opportunityId } = await params;
  setRequestLocale(locale);
  return <Suspense fallback={<DetailSkeleton />}><DetailContent locale={locale} opportunityId={opportunityId} /></Suspense>;
}

async function DetailContent({ locale, opportunityId }: { locale: string; opportunityId: string }) {
  const user = await requirePerm(locale, "followup.view");
  const permissions = await getMyPerms(user.id);
  const canWrite = permissions.has("followup.write");
  const [workspace, staff] = await Promise.all([
    loadRenewalWorkspace(),
    canWrite ? listStaffMembers() : Promise.resolve([]),
  ]);
  const opportunity = workspace.opportunities.find((item) => item.id === opportunityId);
  if (!opportunity) notFound();
  const scopedOwners = scopedRenewalStaffOptions(staff, user.id, permissions.has("student.assign"));
  const owners = scopedOwners.some((owner) => owner.id === opportunity.ownerId)
    ? scopedOwners
    : [...scopedOwners, { id: opportunity.ownerId, name: opportunity.ownerName }];
  return <RenewalOpportunityDetail
    opportunity={opportunity}
    owners={owners}
    courses={workspace.courses}
    terms={workspace.terms}
    canWrite={canWrite}
  />;
}

function DetailSkeleton() {
  return <div aria-hidden className="space-y-5 py-8"><div className="h-24 animate-pulse rounded-xl bg-line/20" /><div className="h-80 animate-pulse rounded-xl bg-line/20" /></div>;
}

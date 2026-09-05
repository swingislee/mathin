import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { LongTermGrowthWorkspace } from "@/features/school/LongTermGrowthWorkspace";
import { loadGrowthWorkspaceData, scopedRenewalStaffOptions } from "@/features/school/renewals";
import { listStaffMembers } from "@/features/school/staff";
import { getMyPerms, requirePerm } from "@/lib/auth";

export default async function RenewalGrowthPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Suspense fallback={<GrowthSkeleton />}><GrowthContent locale={locale} /></Suspense>;
}

async function GrowthContent({ locale }: { locale: string }) {
  const user = await requirePerm(locale, "followup.view");
  const permissions = await getMyPerms(user.id);
  const canWrite = permissions.has("followup.write");
  const [data, staff] = await Promise.all([
    loadGrowthWorkspaceData(),
    canWrite ? listStaffMembers() : Promise.resolve([]),
  ]);
  return <LongTermGrowthWorkspace
    data={data}
    owners={scopedRenewalStaffOptions(staff, user.id, permissions.has("student.assign"))}
    canWrite={canWrite}
  />;
}

function GrowthSkeleton() {
  return <div aria-hidden className="space-y-5 py-8">
    <div className="h-20 animate-pulse rounded-xl bg-line/20" />
    <div className="h-12 animate-pulse rounded-xl bg-line/20" />
    <div className="h-72 animate-pulse rounded-xl bg-line/20" />
    <div className="h-72 animate-pulse rounded-xl bg-line/20" />
  </div>;
}

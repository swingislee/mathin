import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { RenewalStudentPool } from "@/features/school/RenewalStudentPool";
import { loadRenewalWorkspace } from "@/features/school/renewals";
import { loadRenewalPoolSupplement } from "@/features/school/renewal-pool-data";
import { getOrganizationTimezoneV2 } from "@/features/school/organization-locations";
import { getMyPerms, requirePerm } from "@/lib/auth";
import { loadStudentBusinessHistory } from "@/features/school/student-business-history-data";
import { businessRecordStateFilter } from '@/features/school/business-record-state-contract';

export default async function RenewalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Suspense fallback={<RenewalsSkeleton />}><RenewalsContent locale={locale} searchParams={searchParams} /></Suspense>;
}

async function RenewalsContent({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, raw] = await Promise.all([requirePerm(locale, "followup.view"), searchParams]);
  const permissions = await getMyPerms(user.id);
  const canWrite = permissions.has("followup.write");
  const cycle = typeof raw.cycle === "string" ? raw.cycle : null;
  const [{ data, supplement }, timeZone, history] = await Promise.all([
    loadRenewalWorkspace(cycle).then(async data => ({ data, supplement: await loadRenewalPoolSupplement(data, user.id) })),
    getOrganizationTimezoneV2(),
    loadStudentBusinessHistory(locale, { kind: 'renewal', projection: 'workbench' }),
  ]);
  return <RenewalStudentPool
    key={`${data.selectedCycleId ?? "none"}:${typeof raw.tab === "string" ? raw.tab : "pool"}:${raw.samples === "1"}`}
    data={data}
    timeZone={timeZone}
    supplement={supplement}
    canWrite={canWrite}
    canReview={permissions.has("review.write")}
    canEnroll={permissions.has("enrollment.manage")}
    settings={raw.tab === "settings"}
    health={raw.tab === "health"}
    allowHealthSamples={process.env.NODE_ENV === "development"}
    healthSampleMode={process.env.NODE_ENV === "development" && raw.samples === "1"}
    history={history}
    initialQuery={typeof raw.q==='string'?raw.q.slice(0,100):undefined}
    initialRecordState={businessRecordStateFilter(raw.view==='history'?'historical':raw.state)}
  />;
}

function RenewalsSkeleton() {
  return <div aria-hidden className="space-y-5 py-8">
    <div className="h-20 animate-pulse rounded-xl bg-line/20" />
    <div className="h-12 animate-pulse rounded-xl bg-line/20" />
    <div className="h-72 animate-pulse rounded-xl bg-line/20" />
  </div>;
}

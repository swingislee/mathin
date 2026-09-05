import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { RenewalStudentPool } from "@/features/school/RenewalStudentPool";
import { loadRenewalWorkspace } from "@/features/school/renewals";
import { loadRenewalPoolSupplement } from "@/features/school/renewal-pool-data";
import { getMyPerms, requirePerm } from "@/lib/auth";

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
  const data = await loadRenewalWorkspace(cycle);
  const supplement = await loadRenewalPoolSupplement(data, user.id);
  return <RenewalStudentPool
    key={`${data.selectedCycleId ?? "none"}:${typeof raw.tab === "string" ? raw.tab : "pool"}:${raw.samples === "1"}`}
    data={data}
    supplement={supplement}
    canWrite={canWrite}
    canReview={permissions.has("review.write")}
    canEnroll={permissions.has("enrollment.manage")}
    settings={raw.tab === "settings"}
    health={raw.tab === "health"}
    allowHealthSamples={process.env.NODE_ENV === "development"}
    healthSampleMode={process.env.NODE_ENV === "development" && raw.samples === "1"}
  />;
}

function RenewalsSkeleton() {
  return <div aria-hidden className="space-y-5 py-8">
    <div className="h-20 animate-pulse rounded-xl bg-line/20" />
    <div className="h-12 animate-pulse rounded-xl bg-line/20" />
    <div className="h-72 animate-pulse rounded-xl bg-line/20" />
  </div>;
}

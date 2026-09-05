import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { TeacherProfessionalSignalsWorkspace } from "@/features/school/TeacherProfessionalSignalsWorkspace";
import { loadProfessionalSignalsData, scopedRenewalStaffOptions } from "@/features/school/renewals";
import { listStaffMembers } from "@/features/school/staff";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";

export default async function RenewalSignalsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Suspense fallback={<SignalsSkeleton />}><SignalsContent locale={locale} /></Suspense>;
}

async function SignalsContent({ locale }: { locale: string }) {
  const user = await requireAnyPerm(locale, ["review.write", "followup.view"]);
  const permissions = await getMyPerms(user.id);
  const canResolve = permissions.has("followup.write");
  const [data, staff] = await Promise.all([
    loadProfessionalSignalsData(),
    canResolve ? listStaffMembers() : Promise.resolve([]),
  ]);
  return <TeacherProfessionalSignalsWorkspace
    data={data}
    owners={scopedRenewalStaffOptions(staff, user.id, permissions.has("student.assign"))}
    canCreate={permissions.has("review.write")}
    canResolve={canResolve}
  />;
}

function SignalsSkeleton() {
  return <div aria-hidden className="space-y-5 py-8">
    <div className="h-20 animate-pulse rounded-xl bg-line/20" />
    <div className="h-12 animate-pulse rounded-xl bg-line/20" />
    <div className="h-80 animate-pulse rounded-xl bg-line/20" />
  </div>;
}

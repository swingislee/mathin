import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { ClassroomFilters } from "@/features/school/ClassroomFilters";
import { ClassroomList } from "@/features/school/ClassroomList";
import { ClassroomScopeSwitch } from "@/features/school/ClassroomScopeSwitch";
import { ClassroomTestBulkPanel } from "@/features/school/ClassroomTestBulkPanel";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { listClassroomsForScope, parseClassroomListFilters, resolveClassroomScope } from "@/features/school/teaching-operations/classroom-queries";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requireUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

export default async function ClassesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("school.classes");
  return (
    <div className="mx-auto w-full max-w-6xl">
      <SchoolPageHeader title={t("title")}>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("intro")}</p>
      </SchoolPageHeader>
      <Suspense fallback={<div className="mt-6 h-56 animate-pulse rounded-2xl border border-line bg-card" />}>
        <ClassroomLibrary locale={locale} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ClassroomLibrary({ locale, searchParams }: { locale: string; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [rawSearchParams, user] = await Promise.all([searchParams, requireUser(locale)]);
  const t = await getTranslations("school.classes");

  let scope;
  try {
    scope = await resolveClassroomScope(rawSearchParams.scope);
  } catch (error) {
    if (error instanceof Error && error.message.includes("FORBIDDEN")) {
      return <section className="mt-6 rounded-2xl border border-line bg-card p-6">
        <h1 className="font-display text-2xl text-ink">{t("noAccessTitle")}</h1>
        <p className="mt-2 text-sm text-muted">{t("noAccessHint")}</p>
      </section>;
    }
    throw error;
  }

  const [perms, filters] = await Promise.all([getMyPerms(user.id), Promise.resolve(parseClassroomListFilters(rawSearchParams))]);
  const { classrooms, totalCount } = await listClassroomsForScope(scope.scope, filters);
  const resetHref = `/dashboard/classes?scope=${scope.scope}`;
  const hasFilters = Boolean(filters.q || filters.teacherId || filters.supportId || filters.grade || filters.schoolTermId || filters.operationalStatus || filters.purpose || filters.readiness);

  return <section className="mt-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-medium text-ink">{t("scopeLabel")}</p>
        <ClassroomScopeSwitch activeScope={scope.scope} availableScopes={scope.availableScopes} />
      </div>
      {perms.has("class.create") && (
        <Link href="/dashboard/classes/new" className={cn(buttonVariants({ size: "sm" }))}>{t("newClass")}</Link>
      )}
    </div>
    <ClassroomFilters filters={filters} scope={scope.scope} />
    {scope.scope === "test" ? (
      <ClassroomTestBulkPanel classrooms={classrooms} />
    ) : (
      <ClassroomList classrooms={classrooms} totalCount={totalCount} scope={scope.scope} hasFilters={hasFilters} resetHref={resetHref} />
    )}
  </section>;
}

import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { ClassroomFilters } from "@/features/school/ClassroomFilters";
import { ClassroomList } from "@/features/school/ClassroomList";
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
      <SchoolPageHeader
        title={t("title")}
        actions={<Suspense fallback={null}><NewClassAction locale={locale} /></Suspense>}
      />
      <Suspense fallback={<div className="mt-6 h-56 animate-pulse rounded-2xl border border-line bg-card" />}>
        <ClassroomLibrary locale={locale} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ClassroomLibrary({ locale, searchParams }: { locale: string; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [rawSearchParams] = await Promise.all([searchParams, requireUser(locale)]);
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

  const filters = parseClassroomListFilters(rawSearchParams);
  const { classrooms, totalCount } = await listClassroomsForScope(scope.scope, filters);
  const resetHref = `/dashboard/classes?scope=${scope.scope}`;
  const hasFilters = Boolean(filters.q || filters.teacherId || filters.supportId || filters.grade || filters.schoolTermId || filters.operationalStatus || filters.purpose || filters.readiness);

  return <section>
    <ClassroomFilters filters={filters} scope={scope.scope} availableScopes={scope.availableScopes} />
    {scope.scope === "test" ? (
      <ClassroomTestBulkPanel classrooms={classrooms} />
    ) : (
      <ClassroomList classrooms={classrooms} totalCount={totalCount} scope={scope.scope} hasFilters={hasFilters} resetHref={resetHref} />
    )}
  </section>;
}

async function NewClassAction({ locale }: { locale: string }) {
  const user = await requireUser(locale);
  const [t, perms] = await Promise.all([getTranslations("school.classes"), getMyPerms(user.id)]);
  if (!perms.has("class.create")) return null;
  return <Link href="/dashboard/classes/new" className={cn(buttonVariants({ size: "sm" }))}>{t("newClass")}</Link>;
}

import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { ClassroomFilters } from "@/features/school/ClassroomFilters";
import { ClassroomList } from "@/features/school/ClassroomList";
import { ClassroomScopeSwitch } from "@/features/school/ClassroomScopeSwitch";
import { ClassroomTestBulkPanel } from "@/features/school/ClassroomTestBulkPanel";
import {
  DashboardCommandActions,
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardPage,
} from "@/features/school/dashboard-page";
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
    <DashboardPage
      title={t("title")}
      commandPanel={
        <Suspense fallback={<DashboardCommandPanel />}>
          <ClassroomCommandPanel locale={locale} searchParams={searchParams} />
        </Suspense>
      }
    >
      <Suspense fallback={<div className="h-56 animate-pulse rounded-2xl border border-line bg-card" />}>
        <ClassroomLibrary locale={locale} searchParams={searchParams} />
      </Suspense>
    </DashboardPage>
  );
}

async function ClassroomCommandPanel({ locale, searchParams }: { locale: string; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [rawSearchParams, user] = await Promise.all([searchParams, requireUser(locale)]);
  const [scope, t, perms] = await Promise.all([
    // scope 解析失败（无任何班级 scope 权限）时正文会给出说明，命令面板保持空壳，
    // 不要在 sticky chrome 里抛错把整页打掉。
    resolveClassroomScope(rawSearchParams.scope).catch(() => null),
    getTranslations("school.classes"),
    getMyPerms(user.id),
  ]);
  if (!scope) return <DashboardCommandPanel />;
  const filters = parseClassroomListFilters(rawSearchParams);
  return (
    <DashboardCommandPanel>
      <DashboardCommandState>
        <ClassroomScopeSwitch activeScope={scope.scope} availableScopes={scope.availableScopes} />
      </DashboardCommandState>
      <DashboardCommandFilters>
        <ClassroomFilters filters={filters} scope={scope.scope} />
      </DashboardCommandFilters>
      {perms.has("class.create") ? (
        <DashboardCommandActions>
          <Link href="/dashboard/classes/new" className={cn(buttonVariants({ size: "sm" }))}>{t("newClass")}</Link>
        </DashboardCommandActions>
      ) : null}
    </DashboardCommandPanel>
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
      return <section className="rounded-2xl border border-line bg-card p-6">
        <h2 className="font-display text-2xl text-ink">{t("noAccessTitle")}</h2>
        <p className="mt-2 text-sm text-muted">{t("noAccessHint")}</p>
      </section>;
    }
    throw error;
  }

  const filters = parseClassroomListFilters(rawSearchParams);
  const { classrooms, totalCount } = await listClassroomsForScope(scope.scope, filters);
  const resetHref = `/dashboard/classes?scope=${scope.scope}`;
  const hasFilters = Boolean(filters.q || filters.teacherId || filters.supportId || filters.grade || filters.schoolTermId || filters.operationalStatus || filters.purpose || filters.readiness);

  return scope.scope === "test"
    ? <ClassroomTestBulkPanel classrooms={classrooms} />
    : <ClassroomList classrooms={classrooms} totalCount={totalCount} scope={scope.scope} hasFilters={hasFilters} resetHref={resetHref} />;
}

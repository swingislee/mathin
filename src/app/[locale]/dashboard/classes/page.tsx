import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { ClassroomFilters } from "@/features/school/ClassroomFilters";
import { ClassroomList } from "@/features/school/ClassroomList";
import { ClassroomScopeSwitch } from "@/features/school/ClassroomScopeSwitch";
import { ClassroomTestBulkPanel } from "@/features/school/ClassroomTestBulkPanel";
import {
  DashboardCard,
  DashboardCommandActions,
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardPage,
} from "@/features/school/dashboard-page";
import { getOrganizationTimezoneV2 } from "@/features/school/organization-locations";
import {
  CLASSROOM_LIST_PAGE_SIZE,
  listClassroomsForScope,
  parseClassroomListFilters,
  resolveClassroomScope,
  type ClassroomListFilters,
} from "@/features/school/teaching-operations/classroom-queries";
import type { ClassroomScope } from "@/features/school/teaching-operations/types";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requireDashboardEnvironment } from "@/lib/auth";
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
  const [rawSearchParams, { user }] = await Promise.all([searchParams, requireDashboardEnvironment(locale, ["staff"])]);
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
  const [rawSearchParams, t, timeZone] = await Promise.all([
    searchParams,
    getTranslations("school.classes"),
    getOrganizationTimezoneV2(),
    requireDashboardEnvironment(locale, ["staff"]),
  ]);

  let scope;
  try {
    scope = await resolveClassroomScope(rawSearchParams.scope);
  } catch (error) {
    if (error instanceof Error && error.message.includes("FORBIDDEN")) {
      return <DashboardCard title={t("noAccessTitle")} description={t("noAccessHint")} />;
    }
    throw error;
  }

  const filters = parseClassroomListFilters(rawSearchParams);
  const { classrooms, totalCount } = await listClassroomsForScope(scope.scope, filters);
  const resetHref = `/dashboard/classes?scope=${scope.scope}`;
  const hasFilters = Boolean(filters.q || filters.teacherId || filters.supportId || filters.grade || filters.schoolTermId || filters.operationalStatus || filters.purpose || filters.readiness);
  const totalPages = Math.ceil(totalCount / CLASSROOM_LIST_PAGE_SIZE);
  const list = scope.scope === "test"
    ? <ClassroomTestBulkPanel classrooms={classrooms} />
    : (
        <ClassroomList
          classrooms={classrooms}
          totalCount={totalCount}
          scope={scope.scope}
          hasFilters={hasFilters}
          resetHref={resetHref}
          locale={locale}
          timeZone={timeZone}
        />
      );

  return (
    <div className="space-y-4">
      {scope.fellBackToAll ? (
        <p role="status" className="border-y border-line bg-moon/15 px-4 py-3 text-sm text-muted">{t("fallbackToAll")}</p>
      ) : null}
      {list}
      <ClassroomPagination scope={scope.scope} filters={filters} totalPages={totalPages} />
    </div>
  );
}

function classroomPageHref(scope: ClassroomScope, filters: ClassroomListFilters, page: number) {
  const query = new URLSearchParams({ scope });
  if (filters.q) query.set("q", filters.q);
  if (filters.teacherId) query.set("teacherId", filters.teacherId);
  if (filters.supportId) query.set("supportId", filters.supportId);
  if (filters.grade) query.set("grade", String(filters.grade));
  if (filters.schoolTermId) query.set("schoolTermId", filters.schoolTermId);
  if (filters.operationalStatus) query.set("operationalStatus", filters.operationalStatus);
  if (filters.purpose) query.set("purpose", filters.purpose);
  if (filters.readiness) query.set("readiness", filters.readiness);
  if (page > 1) query.set("page", String(page));
  return `/dashboard/classes?${query.toString()}`;
}

async function ClassroomPagination({
  scope,
  filters,
  totalPages,
}: {
  scope: ClassroomScope;
  filters: ClassroomListFilters;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;
  const t = await getTranslations("school.classes");
  return (
    <nav className="flex items-center justify-between border-t border-line pt-4" aria-label={t("paginationLabel")}>
      {filters.page > 1 ? (
        <Link href={classroomPageHref(scope, filters, filters.page - 1)} className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("previousPage")}</Link>
      ) : <span />}
      <span className="text-xs text-muted">{t("pageSummary", { page: filters.page, total: totalPages })}</span>
      {filters.page < totalPages ? (
        <Link href={classroomPageHref(scope, filters, filters.page + 1)} className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("nextPage")}</Link>
      ) : <span />}
    </nav>
  );
}

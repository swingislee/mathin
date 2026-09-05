import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { toSelectValue } from "@/features/school/controls";
import { getStaffStats, type StaffStats } from "@/features/school/dashboard";
import {
  DashboardCommandActions,
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardCommandTabs,
  DashboardEmptyCard,
  DashboardPage,
} from "@/features/school/dashboard-page";
import { FilterBar, FilterBarMore, FilterBarReset, FilterBarSubmit, FilterSearchInput, FilterSelectTrigger } from "@/features/school/FilterBar";
import { NewStudentDialog } from "@/features/school/NewStudentDialog";
import { StatusStrip, type StatusStripItem } from "@/features/school/dashboard-page";
import { StudentsTable } from "@/features/school/StudentsTable";
import { FOLLOW_UP_STATUSES, listStudents, parseStudentFilters, STUDENT_STATUSES } from "@/features/school/students";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { cn } from "@/lib/utils";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function StudentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, rawSearchParams] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ["student.view.all", "student.view.assigned"]);
  const t = await getTranslations("school.students");
  const commonT = await getTranslations("common");
  const schoolT = await getTranslations("school");
  const perms = await getMyPerms(user.id);
  const canCreate = perms.has("student.create");
  const canImport = perms.has("student.import");
  const canDelete = perms.has("student.delete");
  const filters = parseStudentFilters(rawSearchParams);
  const emptyStats: StaffStats = { enrolledCount: 0, leadCount: 0, weekSessionCount: 0, overdueFollowUpCount: 0 };
  const [{ students, count }, stats]: [Awaited<ReturnType<typeof listStudents>>, StaffStats] = await Promise.all([
    listStudents(filters),
    perms.has("student.view.all") ? safe(getStaffStats, emptyStats) : Promise.resolve(emptyStats),
  ]);
  const maxPage = count ? Math.max(1, Math.ceil(count / 20)) : filters.page;
  const activeFilterCount = [filters.q, filters.status, filters.followUpStatus, filters.grade].filter(Boolean).length;
  const statusItems: StatusStripItem[] = perms.has("student.view.all")
    ? [
        { label: schoolT("home.statEnrolled"), value: stats.enrolledCount },
        { label: schoolT("home.statLeads"), value: stats.leadCount },
        { label: schoolT("home.statWeekSessions"), value: stats.weekSessionCount },
        { label: schoolT("home.statOverdueFollowUps"), value: stats.overdueFollowUpCount, tone: stats.overdueFollowUpCount > 0 ? "warning" : "default" },
      ]
    : [];

  const pageHref = (page: number) => {
    const query = new URLSearchParams();
    if (filters.status) query.set("status", filters.status);
    if (filters.followUpStatus) query.set("followUpStatus", filters.followUpStatus);
    if (filters.grade) query.set("grade", String(filters.grade));
    if (filters.q) query.set("q", filters.q);
    if (filters.recycle) query.set("tab", "recycle");
    if (page > 1) query.set("page", String(page));
    const qs = query.toString();
    return `/dashboard/students${qs ? `?${qs}` : ""}`;
  };

  return (
    <DashboardPage
      title={filters.recycle ? t("recycleBin") : t("title")}
      commandPanel={
        <DashboardCommandPanel>
          {canDelete ? (
            <DashboardCommandState>
              <DashboardCommandTabs
                ariaLabel={t("title")}
                activeValue={filters.recycle ? "recycle" : "active"}
                items={[
                  { value: "active", label: t("scopeActive"), href: "/dashboard/students" },
                  { value: "recycle", label: t("scopeRecycle"), href: "/dashboard/students?tab=recycle" },
                ]}
              />
            </DashboardCommandState>
          ) : null}

          <DashboardCommandFilters>
            <FilterBar aria-label={t("filter")}>
              {filters.recycle && <Input type="hidden" name="tab" value="recycle" />}
              <FilterSearchInput
                name="q"
                defaultValue={filters.q}
                placeholder={t("search")}
                aria-label={t("search")}
              />
              <FilterBarMore label={commonT("moreFilters")} activeCount={activeFilterCount}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Select name="status" defaultValue={toSelectValue(filters.status ?? "")}>
                    <FilterSelectTrigger className="w-full"><SelectValue /></FilterSelectTrigger>
                    <SelectContent>
                      <SelectItem value={toSelectValue("")}>{t("allStatuses")}</SelectItem>
                      {STUDENT_STATUSES.map((status) => <SelectItem key={status} value={status}>{t(status)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select name="followUpStatus" defaultValue={toSelectValue(filters.followUpStatus ?? "")}>
                    <FilterSelectTrigger className="w-full"><SelectValue /></FilterSelectTrigger>
                    <SelectContent>
                      <SelectItem value={toSelectValue("")}>{t("allFollowUps")}</SelectItem>
                      {FOLLOW_UP_STATUSES.map((status) => <SelectItem key={status} value={status}>{t(status)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select name="grade" defaultValue={toSelectValue(String(filters.grade ?? ""))}>
                    <FilterSelectTrigger className="w-full"><SelectValue /></FilterSelectTrigger>
                    <SelectContent>
                      <SelectItem value={toSelectValue("")}>{t("allGrades")}</SelectItem>
                      {Array.from({ length: 9 }, (_, index) => index + 1).map((grade) => (
                        <SelectItem key={grade} value={String(grade)}>{t("grade", { grade })}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </FilterBarMore>
              <FilterBarSubmit>{t("filter")}</FilterBarSubmit>
              {activeFilterCount > 0 && (
                <FilterBarReset href={filters.recycle ? "/dashboard/students?tab=recycle" : "/dashboard/students"} label={t("reset")} />
              )}
            </FilterBar>
          </DashboardCommandFilters>

          {!filters.recycle && (canImport || canCreate) ? (
            <DashboardCommandActions>
              {canImport && <Link href="/dashboard/students/import" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("import")}</Link>}
              {canCreate && <NewStudentDialog />}
            </DashboardCommandActions>
          ) : null}
        </DashboardCommandPanel>
      }
      summary={!filters.recycle && statusItems.length > 0 ? <StatusStrip items={statusItems} /> : null}
      footer={
        filters.page > 1 || filters.page < maxPage ? (
          <div className="flex justify-end gap-2">
            {filters.page > 1 && <Link href={pageHref(filters.page - 1)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("previous")}</Link>}
            {filters.page < maxPage && <Link href={pageHref(filters.page + 1)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("next")}</Link>}
          </div>
        ) : null
      }
    >
      {students.length === 0 ? (
        <DashboardEmptyCard>{t("empty")}</DashboardEmptyCard>
      ) : (
        <StudentsTable students={students} locale={locale} recycle={filters.recycle} canDelete={canDelete} />
      )}
    </DashboardPage>
  );
}

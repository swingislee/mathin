import { getTranslations, setRequestLocale } from "next-intl/server";
import { AssessmentAggregateWorkbench } from "@/features/school/AssessmentAggregateWorkbench";
import {
  assessmentWorkbenchCounts,
  assessmentWorkbenchRowsForView,
  ASSESSMENT_WORKBENCH_QUEUES,
  parseAssessmentWorkbenchFilters,
  type AssessmentWorkbenchQueue,
} from "@/features/school/assessment-workbench-contract";
import { listAssessmentWorkbenchRows } from "@/features/school/assessment-workbench-data";
import {
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardCommandTabs,
  DashboardEmptyCard,
  DashboardPage,
} from "@/features/school/dashboard-page";
import { FilterBar, FilterBarReset, FilterBarSubmit, FilterSearchInput } from "@/features/school/FilterBar";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";

export default async function AssessmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, rawSearchParams] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ["review.write", "followup.view"]);
  const filters = parseAssessmentWorkbenchFilters(rawSearchParams);
  const [t, permissions, allRows] = await Promise.all([
    getTranslations("school.assessments"),
    getMyPerms(user.id),
    listAssessmentWorkbenchRows(),
  ]);
  const counts = assessmentWorkbenchCounts(allRows);
  const rows = assessmentWorkbenchRowsForView(allRows, filters, locale);
  const hrefFor = (queue: AssessmentWorkbenchQueue, q = filters.q) => {
    const query = new URLSearchParams();
    if (queue !== "pending") query.set("queue", queue);
    if (q) query.set("q", q);
    const value = query.toString();
    return `/dashboard/assessments${value ? `?${value}` : ""}`;
  };
  const countBadge = (count: number) => (
    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-line/70 px-1.5 text-[11px] leading-5 text-ink">
      {count}
    </span>
  );

  return (
    <DashboardPage
      title={t("title")}
      description={t("intro")}
      density="compact"
      commandPanel={(
        <DashboardCommandPanel>
          <DashboardCommandState>
            <DashboardCommandTabs
              ariaLabel={t("queueLabel")}
              activeValue={filters.queue}
              activeTone="accent"
              items={ASSESSMENT_WORKBENCH_QUEUES.map((queue) => ({
                value: queue,
                label: t(`queue_${queue}`),
                href: hrefFor(queue),
                badge: countBadge(counts[queue]),
              }))}
            />
          </DashboardCommandState>
          <DashboardCommandFilters>
            <FilterBar action={`/${locale}/dashboard/assessments`} method="get" aria-label={t("filterLabel")}>
              {filters.queue !== "pending" ? <input type="hidden" name="queue" value={filters.queue} /> : null}
              <FilterSearchInput
                name="q"
                defaultValue={filters.q}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchPlaceholder")}
              />
              <FilterBarSubmit>{t("search")}</FilterBarSubmit>
              {filters.q ? <FilterBarReset href={hrefFor(filters.queue, undefined)} label={t("reset")} /> : null}
            </FilterBar>
          </DashboardCommandFilters>
        </DashboardCommandPanel>
      )}
    >
      {rows.length > 0 ? (
        <AssessmentAggregateWorkbench
          key={`${filters.queue}:${filters.q ?? ""}`}
          rows={rows}
          locale={locale}
          canAssess={permissions.has("review.write")}
        />
      ) : <DashboardEmptyCard>{t(`empty_${filters.queue}`)}</DashboardEmptyCard>}
    </DashboardPage>
  );
}

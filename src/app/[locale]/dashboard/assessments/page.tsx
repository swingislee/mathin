import { ArrowLeftRight } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { SupportAssessmentPreview } from "@/features/school/SupportAssessmentPreview";
import { TeacherAssessmentQueue } from "@/features/school/TeacherAssessmentQueue";
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
  DashboardCommandActions,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardCommandTabs,
  DashboardEmptyCard,
  DashboardPage,
} from "@/features/school/dashboard-page";
import { FilterBar, FilterBarReset, FilterBarSubmit, FilterSearchInput } from "@/features/school/FilterBar";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { cn } from "@/lib/utils";

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
  const permissions = await getMyPerms(user.id);
  const canAssess = permissions.has("review.write");
  const canSupport = permissions.has("followup.view");
  const requestedDesk = firstParam(rawSearchParams.desk);
  const supportPreviewEnabled = process.env.NODE_ENV !== "production";
  const showSupportDesk = supportPreviewEnabled
    && canSupport
    && (requestedDesk === "support" || (!canAssess && requestedDesk !== "teacher"));

  if (showSupportDesk) {
    return <SupportAssessmentPreview locale={locale} canSwitchToTeacher={canAssess} />;
  }

  const filters = parseAssessmentWorkbenchFilters(rawSearchParams);
  const [t, hubT, allRows] = await Promise.all([
    getTranslations("school.assessments"),
    getTranslations("school.assessmentHub"),
    listAssessmentWorkbenchRows(),
  ]);
  const counts = assessmentWorkbenchCounts(allRows);
  const rows = assessmentWorkbenchRowsForView(allRows, filters, locale);
  const hrefFor = (queue: AssessmentWorkbenchQueue, q = filters.q) => {
    const query = new URLSearchParams();
    query.set("desk", "teacher");
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
      title={hubT("title")}
      eyebrow={hubT("teacherDesk")}
      description={t("teacherIntro")}
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
              <input type="hidden" name="desk" value="teacher" />
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
          {supportPreviewEnabled && canSupport ? (
            <DashboardCommandActions>
              <Link
                href="/dashboard/assessments?desk=support"
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "h-9 px-3 text-xs")}
              >
                <ArrowLeftRight className="size-3.5" />
                {hubT("switchToSupport")}
              </Link>
            </DashboardCommandActions>
          ) : null}
        </DashboardCommandPanel>
      )}
    >
      {rows.length > 0 ? (
        <TeacherAssessmentQueue
          key={`${filters.queue}:${filters.q ?? ""}`}
          rows={rows}
          locale={locale}
          canAssess={canAssess}
        />
      ) : <DashboardEmptyCard>{t(`empty_${filters.queue}`)}</DashboardEmptyCard>}
    </DashboardPage>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

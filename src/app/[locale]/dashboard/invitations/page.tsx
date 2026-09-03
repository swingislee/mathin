import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardCommandTabs,
  DashboardEmptyCard,
  DashboardPage,
} from "@/features/school/dashboard-page";
import {
  FilterBar,
  FilterBarReset,
  FilterBarSubmit,
  FilterSearchInput,
} from "@/features/school/FilterBar";
import { InvitationCoordinationWorkbench } from "@/features/school/InvitationCoordinationWorkbench";
import {
  listInvitationCoordination,
  listInvitationOptions,
  listInvitationQueueCounts,
  parseInvitationFilters,
} from "@/features/school/invitations";
import type { InvitationCoordinationStage, InvitationQueue } from "@/features/school/invitation-contract";
import { requirePerm } from "@/lib/auth";

const QUEUES = [
  "coordination",
  "confirmed",
  "waiting_activity",
  "closed",
] as const satisfies readonly InvitationQueue[];
const COORDINATION_STAGES = [
  "all",
  "coordinating_time",
  "awaiting_teacher",
  "awaiting_parent",
] as const satisfies readonly InvitationCoordinationStage[];

export default async function InvitationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, rawSearchParams] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  await requirePerm(locale, "followup.view");
  const filters = parseInvitationFilters(rawSearchParams);
  const [t, rows, options, counts] = await Promise.all([
    getTranslations("school.invitations"),
    listInvitationCoordination(filters),
    listInvitationOptions(),
    listInvitationQueueCounts(),
  ]);
  const hrefForQueue = (queue: InvitationQueue, q = filters.q) => {
    const query = new URLSearchParams();
    if (queue !== "coordination") query.set("queue", queue);
    if (q) query.set("q", q);
    const qs = query.toString();
    return `/dashboard/invitations${qs ? `?${qs}` : ""}`;
  };
  const hrefForStage = (stage: InvitationCoordinationStage, q = filters.q) => {
    const query = new URLSearchParams();
    if (stage !== "all") query.set("stage", stage);
    if (q) query.set("q", q);
    const qs = query.toString();
    return `/dashboard/invitations${qs ? `?${qs}` : ""}`;
  };
  const countBadge = (count: number) => (
    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-line/70 px-1.5 text-[11px] leading-5 text-ink">
      {count}
    </span>
  );
  const emptyKey = filters.queue === "coordination"
    ? filters.stage === "all" ? "empty_coordination" : `empty_${filters.stage}`
    : `empty_${filters.queue}`;

  return (
    <DashboardPage
      title={t("title")}
      description={t("intro")}
      commandPanel={(
        <DashboardCommandPanel>
          <DashboardCommandState>
            <div className="grid min-w-0 gap-1.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="w-16 shrink-0 text-[11px] font-medium text-muted">{t("workQueueLabel")}</span>
                <DashboardCommandTabs
                  ariaLabel={t("queueLabel")}
                  activeValue={filters.queue}
                  activeTone="accent"
                  items={QUEUES.map((queue) => ({
                    value: queue,
                    label: t(`queue_${queue}`),
                    href: hrefForQueue(queue),
                    badge: countBadge(counts.queues[queue]),
                  }))}
                />
              </div>
              {filters.queue === "coordination" ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="w-16 shrink-0 text-[11px] font-medium text-muted">{t("stageLabel")}</span>
                  <DashboardCommandTabs
                    ariaLabel={t("stageLabel")}
                    activeValue={filters.stage}
                    activeTone="accent"
                    items={COORDINATION_STAGES.map((stage) => ({
                      value: stage,
                      label: stage === "all" ? t("stage_all") : t(`queue_${stage}`),
                      href: hrefForStage(stage),
                      badge: countBadge(counts.stages[stage]),
                    }))}
                  />
                </div>
              ) : null}
            </div>
          </DashboardCommandState>
          <DashboardCommandFilters>
            <FilterBar action={`/${locale}/dashboard/invitations`} method="get" aria-label={t("filterLabel")}>
              {filters.queue !== "coordination" ? <input type="hidden" name="queue" value={filters.queue} /> : null}
              {filters.queue === "coordination" && filters.stage !== "all" ? <input type="hidden" name="stage" value={filters.stage} /> : null}
              <FilterSearchInput
                name="q"
                defaultValue={filters.q}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchPlaceholder")}
              />
              <FilterBarSubmit>{t("filter")}</FilterBarSubmit>
              {filters.q ? (
                <FilterBarReset
                  href={filters.queue === "coordination"
                    ? hrefForStage(filters.stage, undefined)
                    : hrefForQueue(filters.queue, undefined)}
                  label={t("reset")}
                />
              ) : null}
            </FilterBar>
          </DashboardCommandFilters>
        </DashboardCommandPanel>
      )}
    >
      {rows.length > 0 ? (
        <InvitationCoordinationWorkbench
          key={`${filters.queue}:${filters.stage}:${filters.q ?? ""}`}
          rows={rows}
          activities={options.activities}
          assessors={options.assessors}
          locale={locale}
        />
      ) : <DashboardEmptyCard>{t(emptyKey)}</DashboardEmptyCard>}
    </DashboardPage>
  );
}

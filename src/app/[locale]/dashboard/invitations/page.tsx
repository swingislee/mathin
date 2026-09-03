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
import { listInvitationCoordination, listInvitationOptions, parseInvitationFilters } from "@/features/school/invitations";
import type { InvitationQueue } from "@/features/school/invitation-contract";
import { requirePerm } from "@/lib/auth";

const QUEUES = [
  "coordinating_time",
  "awaiting_teacher",
  "awaiting_parent",
  "confirmed",
  "waiting_activity",
  "closed",
] as const satisfies readonly InvitationQueue[];

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
  const [t, rows, options] = await Promise.all([
    getTranslations("school.invitations"),
    listInvitationCoordination(filters),
    listInvitationOptions(),
  ]);
  const hrefFor = (queue: InvitationQueue, q = filters.q) => {
    const query = new URLSearchParams();
    if (queue !== "coordinating_time") query.set("queue", queue);
    if (q) query.set("q", q);
    const qs = query.toString();
    return `/dashboard/invitations${qs ? `?${qs}` : ""}`;
  };

  return (
    <DashboardPage
      title={t("title")}
      description={t("intro")}
      commandPanel={(
        <DashboardCommandPanel>
          <DashboardCommandState>
            <DashboardCommandTabs
              ariaLabel={t("queueLabel")}
              activeValue={filters.queue}
              items={QUEUES.map((queue) => ({
                value: queue,
                label: t(`queue_${queue}`),
                href: hrefFor(queue),
              }))}
            />
          </DashboardCommandState>
          <DashboardCommandFilters>
            <FilterBar action={`/${locale}/dashboard/invitations`} method="get" aria-label={t("filterLabel")}>
              {filters.queue !== "coordinating_time" ? <input type="hidden" name="queue" value={filters.queue} /> : null}
              <FilterSearchInput
                name="q"
                defaultValue={filters.q}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchPlaceholder")}
              />
              <FilterBarSubmit>{t("filter")}</FilterBarSubmit>
              {filters.q ? <FilterBarReset href={hrefFor(filters.queue, undefined)} label={t("reset")} /> : null}
            </FilterBar>
          </DashboardCommandFilters>
        </DashboardCommandPanel>
      )}
    >
      {rows.length > 0 ? (
        <InvitationCoordinationWorkbench
          rows={rows}
          activities={options.activities}
          assessors={options.assessors}
          locale={locale}
        />
      ) : <DashboardEmptyCard>{t(`empty_${filters.queue}`)}</DashboardEmptyCard>}
    </DashboardPage>
  );
}

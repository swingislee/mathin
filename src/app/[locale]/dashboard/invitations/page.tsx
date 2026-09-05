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
import { PostActivityFollowupTable } from "@/features/school/PostActivityFollowupTable";
import { loadPostActivityFollowups } from "@/features/school/enrollment-workflow-data";
import { followupState } from "@/features/school/enrollment-workflow-contract";
import {
  listInvitationCoordination,
  listInvitationOptions,
  listInvitationQueueCounts,
  parseInvitationFilters,
} from "@/features/school/invitations";
import type { InvitationCoordinationStage, InvitationQueue } from "@/features/school/invitation-contract";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";

const QUEUES = [
  "coordination",
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
  const user = await requireAnyPerm(locale, ["followup.view", "review.write"]);
  const permissions = await getMyPerms(user.id);
  const canManageInvitation = permissions.has("followup.write");
  const isPostActivity = rawSearchParams.queue === "post_activity" && permissions.has("followup.view");
  const filters = parseInvitationFilters(rawSearchParams);
  const activeQueue = isPostActivity ? "post_activity" : filters.queue;
  const [t, rows, options, counts, postActivityRows] = await Promise.all([
    getTranslations("school.invitations"),
    isPostActivity ? Promise.resolve([]) : listInvitationCoordination(filters),
    listInvitationOptions(),
    listInvitationQueueCounts(),
    permissions.has("followup.view") ? loadPostActivityFollowups() : Promise.resolve([]),
  ]);
  const hrefForQueue = (queue: InvitationQueue | "post_activity", q = filters.q) => {
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
            <DashboardCommandTabs
              ariaLabel={t("queueLabel")}
              activeValue={activeQueue}
              activeTone="accent"
              items={[...QUEUES.map((queue) => ({
                value: queue,
                label: t(`queue_${queue}`),
                href: hrefForQueue(queue),
                badge: countBadge(counts.queues[queue]),
              })), ...(permissions.has("followup.view") ? [{ value: "post_activity", label: t("queue_post_activity"), href: hrefForQueue("post_activity"), badge: countBadge(postActivityRows.filter((row) => row.eligible && !["enrolled", "closed"].includes(followupState(row))).length) }] : [])]}
            />
          </DashboardCommandState>
          <DashboardCommandFilters>
            <FilterBar action={`/${locale}/dashboard/invitations`} method="get" aria-label={t("filterLabel")}>
              {activeQueue !== "coordination" ? <input type="hidden" name="queue" value={activeQueue} /> : null}
              {!isPostActivity && filters.queue === "coordination" && filters.stage !== "all" ? <input type="hidden" name="stage" value={filters.stage} /> : null}
              <FilterSearchInput
                name="q"
                defaultValue={filters.q}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchPlaceholder")}
              />
              <FilterBarSubmit>{t("filter")}</FilterBarSubmit>
              {filters.q ? (
                <FilterBarReset
                  href={isPostActivity ? hrefForQueue("post_activity", undefined) : filters.queue === "coordination"
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
      {isPostActivity ? <PostActivityFollowupTable initialRows={postActivityRows} query={filters.q} /> : rows.length > 0 ? (
        <InvitationCoordinationWorkbench
          key={`${filters.queue}:${filters.stage}:${filters.q ?? ""}`}
          rows={rows}
          activities={options.activities}
          assessors={options.assessors}
          locale={locale}
          queue={filters.queue}
          coordinationStage={filters.queue === "coordination" ? filters.stage : null}
          stageCounts={counts.stages}
          searchQuery={filters.q}
          currentUserId={user.id}
          canManageInvitation={canManageInvitation}
        />
      ) : <DashboardEmptyCard>{t(emptyKey)}</DashboardEmptyCard>}
    </DashboardPage>
  );
}

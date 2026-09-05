import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DashboardCommandActions, DashboardCommandFilters, DashboardCommandPanel, DashboardCommandState, DashboardEmptyCard, DashboardPage } from "@/features/school/dashboard-page";
import { FilterBar, FilterSearchInput } from "@/features/school/FilterBar";
import { FollowupTabs } from "@/features/school/FollowupTabs";
import { FollowupQueryMemory } from "@/features/school/FollowupQueryMemory";
import { LeadPoolBatchActions, LeadPoolSelectionProvider } from "@/features/school/LeadPoolSelection";
import { LeadPoolPagination } from "@/features/school/LeadPoolPagination";
import { LeadIntakeWorkbench } from "@/features/school/LeadIntakeWorkbench";
import { listLeadPool, parseLeadPoolFilters } from "@/features/school/leads";
import { listStaffMembers } from "@/features/school/staff";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requirePerm } from "@/lib/auth";

export default async function LeadsPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, raw] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requirePerm(locale, "followup.view");
  const [t, workspaceT, perms] = await Promise.all([getTranslations("school.leads"), getTranslations("school.followupWorkspace"), getMyPerms(user.id)]);
  const canAssign = perms.has("student.assign");
  const canContact = perms.has("followup.write");
  const filters = parseLeadPoolFilters(raw, perms.has("student.view.all"));
  const [{ leads, count, pageSize }, assignees] = await Promise.all([
    listLeadPool(user.id, filters),
    canAssign ? listStaffMembers().then((members) => members.filter((member) => member.isActive && member.canFollowUp).map((member) => ({ userId: member.userId, displayName: member.displayName }))) : Promise.resolve([]),
  ]);
  return <LeadPoolSelectionProvider key={`${filters.scope}:${filters.status ?? ""}:${filters.q ?? ""}:${filters.page}:${filters.pageSize}`} assignableIds={leads.filter((lead) => lead.status !== "invalid" && lead.status !== "converted").map((lead) => lead.id)}>
    <FollowupQueryMemory />
    <DashboardPage title={workspaceT("leads")} commandPanel={<DashboardCommandPanel>
      <DashboardCommandState><FollowupTabs /></DashboardCommandState>
      <DashboardCommandFilters>
        <span className="whitespace-nowrap text-xs tabular-nums text-muted">{workspaceT("count", { count })}</span>
        <FilterBar action={`/${locale}/dashboard/followups/leads`} method="get" aria-label={t("filter")}>
          <Input type="hidden" name="scope" value={filters.scope} />
          {filters.status ? <Input type="hidden" name="status" value={filters.status} /> : null}
          <Input type="hidden" name="pageSize" value={filters.pageSize} />
          <FilterSearchInput name="q" defaultValue={filters.q} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} />
        </FilterBar>
      </DashboardCommandFilters>
      <DashboardCommandActions>
        {canAssign ? <LeadPoolBatchActions assignees={assignees} /> : null}
        {perms.has("student.import") ? <Link href="/dashboard/students/import" className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("openDataInbox")}</Link> : null}
      </DashboardCommandActions>
    </DashboardCommandPanel>} footer={count > 0 ? <LeadPoolPagination currentPage={filters.page} totalPages={Math.max(1, Math.ceil(count / pageSize))} totalCount={count} pageSize={pageSize} scope={filters.scope} status={filters.status} q={filters.q} /> : null}>
      {leads.length ? <LeadIntakeWorkbench leads={leads} locale={locale} currentUserId={user.id} canAssign={canAssign} canManageIdentity={canContact && perms.has("student.edit")} /> : <DashboardEmptyCard>{t("empty")}</DashboardEmptyCard>}
    </DashboardPage>
  </LeadPoolSelectionProvider>;
}

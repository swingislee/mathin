import { getNow, getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DashboardCommandActions, DashboardCommandFilters, DashboardPage } from "@/features/school/dashboard-page";
import { FollowupCommandPanel } from "@/features/school/FollowupCommandPanel";
import { FilterBar, FilterSearchInput } from "@/features/school/FilterBar";
import { FollowupQueryMemory } from "@/features/school/FollowupQueryMemory";
import { LeadPoolBatchActions, LeadPoolSelectionProvider } from "@/features/school/LeadPoolSelection";
import { LeadPoolPagination } from "@/features/school/LeadPoolPagination";
import { LeadIntakeWorkbench } from "@/features/school/LeadIntakeWorkbench";
import { LeadIntakeScopeFilter } from "@/features/school/LeadIntakeScopeFilter";
import { parseLeadPoolFilters } from "@/features/school/leads";
import { listLeadIntakeFieldPage } from "@/features/school/lead-intake-table-data";
import { leadIntakeTableFields } from "@/features/school/lead-intake-table-fields";
import { getOrganizationTimezoneV2 } from "@/features/school/organization-locations";
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
  const [t, workspaceT, perms, tableT, invitationT, timeZone, now] = await Promise.all([getTranslations("school.leads"), getTranslations("school.followupWorkspace"), getMyPerms(user.id),
    getTranslations("school.table"), getTranslations("school.invitations"), getOrganizationTimezoneV2(), getNow()]);
  const canAssign = perms.has("student.assign");
  const canContact = perms.has("followup.write");
  const filters = parseLeadPoolFilters(raw, perms.has("student.view.all"));
  const [{ rows: leads, count, page, pageSize, fieldView, assignableIds }, assignees] = await Promise.all([
    listLeadIntakeFieldPage(user.id, filters, leadIntakeTableFields(t, tableT, invitationT), raw.fields, { locale, timeZone, now: now.getTime() }),
    canAssign ? listStaffMembers().then((members) => members.filter((member) => member.isActive && member.canFollowUp).map((member) => ({ userId: member.userId, displayName: member.displayName }))) : Promise.resolve([]),
  ]);
  const fieldQuery = JSON.stringify(fieldView.query);
  return <LeadPoolSelectionProvider key={`${filters.scope}:${filters.assignment ?? ""}:${filters.status ?? ""}:${filters.q ?? ""}:${page}:${pageSize}`} assignableIds={assignableIds}>
    <FollowupQueryMemory />
    <DashboardPage title={workspaceT("leads")} density="compact" bodyClassName="gap-1.5" commandPanel={<FollowupCommandPanel>

      <DashboardCommandFilters>
        <LeadIntakeScopeFilter filters={filters} fieldQuery={fieldQuery} canScopeAll={perms.has("student.view.all")} />
        <FilterBar className="flex-none" action={`/${locale}/dashboard/leads`} method="get" aria-label={t("filter")}>
          <Input type="hidden" name="scope" value={filters.scope} />
          {filters.assignment ? <Input type="hidden" name="assignment" value={filters.assignment} /> : null}
          {filters.status ? <Input type="hidden" name="status" value={filters.status} /> : null}
          <Input type="hidden" name="pageSize" value={filters.pageSize} />
          <Input type="hidden" name="fields" value={fieldQuery} />
          <FilterSearchInput name="q" defaultValue={filters.q} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} />
        </FilterBar>
      </DashboardCommandFilters>
      <DashboardCommandActions>
        {canAssign ? <LeadPoolBatchActions assignees={assignees} /> : null}
        {perms.has("student.import") ? <Link href="/dashboard/students/import" className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("openDataInbox")}</Link> : null}
      </DashboardCommandActions>
    </FollowupCommandPanel>} footer={<LeadPoolPagination currentPage={page} totalPages={Math.max(1, Math.ceil(count / pageSize))} totalCount={count} pageSize={pageSize} scope={filters.scope} status={filters.status} q={filters.q} extraQuery={{ fields: fieldQuery, ...(filters.assignment ? { assignment: filters.assignment } : {}) }} />}>
      <LeadIntakeWorkbench canAdd={canContact} leads={leads} fieldView={fieldView} timeZone={timeZone} now={now.getTime()} locale={locale} currentUserId={user.id} canAssign={canAssign} canManageIdentity={canContact && perms.has("student.edit")} />
    </DashboardPage>
  </LeadPoolSelectionProvider>;
}

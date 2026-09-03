import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DashboardCommandActions,
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
import { LeadPoolBatchActions, LeadPoolSelectionProvider } from "@/features/school/LeadPoolSelection";
import { LeadPoolPagination } from "@/features/school/LeadPoolPagination";
import { LeadFirstContactWorkbench } from "@/features/school/LeadFirstContactWorkbench";
import { LeadPoolTable } from "@/features/school/LeadPoolTable";
import { listInvitationOptions } from "@/features/school/invitations";
import { LEAD_DEFAULT_PAGE_SIZE, type LeadPageSize } from "@/features/school/lead-contract";
import { listLeadPool, parseLeadPoolFilters } from "@/features/school/leads";
import { listStaffMembers } from "@/features/school/staff";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requirePerm } from "@/lib/auth";

export default async function LeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, rawSearchParams] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requirePerm(locale, "followup.view");
  const [t, perms] = await Promise.all([
    getTranslations("school.leads"),
    getMyPerms(user.id),
  ]);
  const canScopeAll = perms.has("student.view.all");
  const canImport = perms.has("student.import");
  const canAssign = perms.has("student.assign");
  const canContact = perms.has("followup.write");
  const filters = parseLeadPoolFilters(rawSearchParams, canScopeAll);
  const activeQueue = filters.scope === "unassigned"
    ? "unassigned"
    : filters.scope === "mine" && filters.status === "uncontacted"
      ? "first_contact"
      : filters.scope;
  const isFirstContactWorkbench = activeQueue === "first_contact" && canContact;
  const [{ leads, count, pageSize }, assignees, invitationOptions] = await Promise.all([
    listLeadPool(user.id, filters),
    canAssign
      ? listStaffMembers().then((members) => members
          .filter((member) => member.isActive && member.canFollowUp)
          .map((member) => ({ userId: member.userId, displayName: member.displayName })))
      : Promise.resolve([]),
    isFirstContactWorkbench
      ? listInvitationOptions()
      : Promise.resolve({ activities: [], assessors: [] }),
  ]);
  const maxPage = Math.max(1, Math.ceil(count / pageSize));
  const hasKeywordFilter = Boolean(filters.q);
  const assignableIds = leads
    .filter((lead) => lead.status !== "invalid" && lead.status !== "converted")
    .map((lead) => lead.id);

  const hrefFor = (next: {
    scope?: typeof filters.scope;
    status?: typeof filters.status;
    q?: string;
    page?: number;
    pageSize?: LeadPageSize;
  }) => {
    const query = new URLSearchParams();
    const scope = ("scope" in next ? next.scope : filters.scope) ?? "unassigned";
    const status = "status" in next ? next.status : filters.status;
    const q = "q" in next ? next.q : filters.q;
    const page = "page" in next ? next.page : filters.page;
    const nextPageSize = "pageSize" in next ? next.pageSize : filters.pageSize;
    if (scope !== "unassigned") query.set("scope", scope);
    if (status) query.set("status", status);
    if (q) query.set("q", q);
    if (nextPageSize && nextPageSize !== LEAD_DEFAULT_PAGE_SIZE) query.set("pageSize", String(nextPageSize));
    if (page && page > 1) query.set("page", String(page));
    const qs = query.toString();
    return `/dashboard/leads${qs ? `?${qs}` : ""}`;
  };
  return (
    <LeadPoolSelectionProvider
      key={`${filters.scope}:${filters.status ?? ""}:${filters.q ?? ""}:${filters.page}:${filters.pageSize}`}
      assignableIds={assignableIds}
    >
      <DashboardPage
        title={isFirstContactWorkbench ? t("firstContactTitle") : t("title")}
        description={isFirstContactWorkbench ? t("firstContactIntro") : t("intro")}
        commandPanel={
          <DashboardCommandPanel>
          <DashboardCommandState>
            <DashboardCommandTabs
              ariaLabel={t("scopeLabel")}
              activeValue={activeQueue}
              items={[
                { value: "unassigned", label: t("scopeUnassigned"), href: hrefFor({ scope: "unassigned", status: undefined, page: 1 }) },
                { value: "first_contact", label: t("scopeFirstContact"), href: hrefFor({ scope: "mine", status: "uncontacted", page: 1 }) },
                { value: "mine", label: t("scopeMine"), href: hrefFor({ scope: "mine", status: undefined, page: 1 }) },
                ...(canScopeAll
                  ? [{ value: "all", label: t("scopeAll"), href: hrefFor({ scope: "all", status: undefined, page: 1 }) }]
                  : []),
              ]}
            />
          </DashboardCommandState>

          <DashboardCommandFilters>
            <FilterBar action={`/${locale}/dashboard/leads`} method="get" aria-label={t("filter")}>
              {filters.scope !== "unassigned" ? <Input type="hidden" name="scope" value={filters.scope} /> : null}
              {filters.status ? <Input type="hidden" name="status" value={filters.status} /> : null}
              {filters.pageSize !== LEAD_DEFAULT_PAGE_SIZE ? (
                <Input type="hidden" name="pageSize" value={filters.pageSize} />
              ) : null}
              <FilterSearchInput
                name="q"
                defaultValue={filters.q}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchPlaceholder")}
              />
              <FilterBarSubmit>{t("filter")}</FilterBarSubmit>
              {hasKeywordFilter ? (
                <FilterBarReset href={hrefFor({ q: undefined, page: 1 })} label={t("reset")} />
              ) : null}
            </FilterBar>
          </DashboardCommandFilters>

          {(!isFirstContactWorkbench && canAssign) || (filters.scope === "unassigned" && canImport) ? (
            <DashboardCommandActions>
              {!isFirstContactWorkbench && canAssign ? <LeadPoolBatchActions assignees={assignees} /> : null}
              {filters.scope === "unassigned" && canImport ? (
                <Link href="/dashboard/students/import" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                  {t("openDataInbox")}
                </Link>
              ) : null}
            </DashboardCommandActions>
          ) : null}
          </DashboardCommandPanel>
        }
        footer={count > 0 ? (
          <LeadPoolPagination
            currentPage={filters.page}
            totalPages={maxPage}
            totalCount={count}
            pageSize={pageSize}
            scope={filters.scope}
            status={filters.status}
            q={filters.q}
          />
        ) : null}
      >
        {leads.length === 0 ? (
          <DashboardEmptyCard>{t(isFirstContactWorkbench ? "firstContactEmpty" : "empty")}</DashboardEmptyCard>
        ) : isFirstContactWorkbench ? (
          <LeadFirstContactWorkbench
            leads={leads}
            locale={locale}
            activities={invitationOptions.activities}
            assessors={invitationOptions.assessors}
          />
        ) : (
          <LeadPoolTable
            leads={leads}
            locale={locale}
            canAssign={canAssign}
          />
        )}
      </DashboardPage>
    </LeadPoolSelectionProvider>
  );
}

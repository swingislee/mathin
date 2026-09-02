import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toSelectValue } from "@/features/school/controls";
import {
  DashboardCommandActions,
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardCommandTabs,
  DashboardEmptyCard,
  DashboardPage,
  DashboardTableShell,
} from "@/features/school/dashboard-page";
import {
  FilterBar,
  FilterBarReset,
  FilterBarSubmit,
  FilterSearchInput,
  FilterSelectTrigger,
} from "@/features/school/FilterBar";
import { LEAD_STATUSES, listLeadPool, parseLeadPoolFilters } from "@/features/school/leads";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requirePerm } from "@/lib/auth";
import { cn } from "@/lib/utils";

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
  const filters = parseLeadPoolFilters(rawSearchParams, canScopeAll);
  const { leads, count, pageSize } = await listLeadPool(user.id, filters);
  const maxPage = count > 0 ? Math.max(1, Math.ceil(count / pageSize)) : filters.page;
  const activeFilterCount = [filters.q, filters.status].filter(Boolean).length;

  const hrefFor = (next: {
    scope?: typeof filters.scope;
    status?: typeof filters.status;
    q?: string;
    page?: number;
  }) => {
    const query = new URLSearchParams();
    const scope = ("scope" in next ? next.scope : filters.scope) ?? "unassigned";
    const status = "status" in next ? next.status : filters.status;
    const q = "q" in next ? next.q : filters.q;
    const page = "page" in next ? next.page : filters.page;
    if (scope !== "unassigned") query.set("scope", scope);
    if (status) query.set("status", status);
    if (q) query.set("q", q);
    if (page && page > 1) query.set("page", String(page));
    const qs = query.toString();
    return `/dashboard/leads${qs ? `?${qs}` : ""}`;
  };
  const formatAt = (value: string) => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

  return (
    <DashboardPage
      title={t("title")}
      description={t("intro")}
      commandPanel={
        <DashboardCommandPanel>
          <DashboardCommandState>
            <DashboardCommandTabs
              ariaLabel={t("scopeLabel")}
              activeValue={filters.scope}
              items={[
                { value: "unassigned", label: t("scopeUnassigned"), href: hrefFor({ scope: "unassigned", page: 1 }) },
                { value: "mine", label: t("scopeMine"), href: hrefFor({ scope: "mine", page: 1 }) },
                ...(canScopeAll
                  ? [{ value: "all", label: t("scopeAll"), href: hrefFor({ scope: "all", page: 1 }) }]
                  : []),
              ]}
            />
          </DashboardCommandState>

          <DashboardCommandFilters>
            <FilterBar action={`/${locale}/dashboard/leads`} method="get" aria-label={t("filter")}>
              {filters.scope !== "unassigned" ? <Input type="hidden" name="scope" value={filters.scope} /> : null}
              <FilterSearchInput
                name="q"
                defaultValue={filters.q}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchPlaceholder")}
              />
              <Select name="status" defaultValue={toSelectValue(filters.status ?? "")}>
                <FilterSelectTrigger><SelectValue /></FilterSelectTrigger>
                <SelectContent>
                  <SelectItem value={toSelectValue("")}>{t("allStatuses")}</SelectItem>
                  {LEAD_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>{t(`status_${status}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FilterBarSubmit>{t("filter")}</FilterBarSubmit>
              {activeFilterCount > 0 ? (
                <FilterBarReset href={hrefFor({ status: undefined, q: undefined, page: 1 })} label={t("reset")} />
              ) : null}
            </FilterBar>
          </DashboardCommandFilters>

          {canImport ? (
            <DashboardCommandActions>
              <Link href="/dashboard/students/import" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                {t("openDataInbox")}
              </Link>
            </DashboardCommandActions>
          ) : null}
        </DashboardCommandPanel>
      }
      footer={filters.page > 1 || filters.page < maxPage ? (
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted">{t("resultCount", { count })}</span>
          {filters.page > 1 ? (
            <Link href={hrefFor({ page: filters.page - 1 })} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
              {t("previous")}
            </Link>
          ) : null}
          {filters.page < maxPage ? (
            <Link href={hrefFor({ page: filters.page + 1 })} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
              {t("next")}
            </Link>
          ) : null}
        </div>
      ) : null}
    >
      {leads.length === 0 ? (
        <DashboardEmptyCard>{t("empty")}</DashboardEmptyCard>
      ) : (
        <DashboardTableShell>
          <Table className="w-full min-w-[82rem] text-sm">
            <TableHeader>
              <TableRow>
                <TableHead>{t("seed")}</TableHead>
                <TableHead>{t("grade")}</TableHead>
                <TableHead>{t("interests")}</TableHead>
                <TableHead>{t("source")}</TableHead>
                <TableHead>{t("submittedAt")}</TableHead>
                <TableHead>{t("owner")}</TableHead>
                <TableHead>{t("identity")}</TableHead>
                <TableHead>{t("status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell className="min-w-48">
                    <div className="font-medium text-ink">{lead.provisionalStudentName}</div>
                    <div className="mt-0.5 font-mono text-xs text-muted">{lead.phone}</div>
                  </TableCell>
                  <TableCell>{lead.gradeText || (lead.gradeHint ? t("gradeValue", { grade: lead.gradeHint }) : "—")}</TableCell>
                  <TableCell className="max-w-80">
                    <div className="flex flex-wrap gap-1">
                      {lead.interests.length > 0
                        ? lead.interests.map((interest) => <Badge key={interest} variant="outline" className="font-normal">{interest}</Badge>)
                        : <span className="text-muted">—</span>}
                    </div>
                  </TableCell>
                  <TableCell className="min-w-56">
                    <div>{lead.sourceBatchLabel || "—"}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {[lead.sourceRow ? t("sourceRow", { row: lead.sourceRow }) : "", lead.promoter, lead.acquisitionMethod]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </div>
                    {lead.sourceCount > 1 ? <div className="mt-1 text-xs text-muted">{t("sourceCount", { count: lead.sourceCount })}</div> : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted">
                    {lead.submittedAt ? formatAt(lead.submittedAt) : formatAt(lead.createdAt)}
                  </TableCell>
                  <TableCell>{lead.ownerName || t("unassignedOwner")}</TableCell>
                  <TableCell className="min-w-44">
                    <Badge variant="outline">{t("identityUnconfirmed")}</Badge>
                    {lead.suggestedStudentName ? (
                      <p className="mt-1 text-xs text-muted">{t("studentSuggestion", { name: lead.suggestedStudentName })}</p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={lead.status === "invalid" ? "danger" : lead.status === "converted" ? "secondary" : "outline"}>
                      {t(`status_${lead.status}`)}
                    </Badge>
                    {lead.sourceMarkedDuplicate ? <p className="mt-1 text-xs text-rose">{t("sourceDuplicate")}</p> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DashboardTableShell>
      )}
    </DashboardPage>
  );
}

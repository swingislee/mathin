"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import { FollowupPrimaryFilter } from "./FollowupPrimaryFilter";
import { LEAD_WORK_FILTERS, leadWorkFilter, leadWorkFilterQuery } from "./followup-primary-filter-contract";
import { useLeadPoolSelection } from "./LeadPoolSelection";
import type { LeadPoolFilters } from "./lead-contract";

/** 业务范围切换回到第一页，保留分页前执行的字段条件。 */
export function LeadIntakeScopeFilter({ filters, canScopeAll, fieldQuery }: { filters: LeadPoolFilters; canScopeAll: boolean; fieldQuery?: string }) {
  const t = useTranslations("school.leads");
  const filterT = useTranslations("school.followupFilters");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { assignmentPending } = useLeadPoolSelection();
  const view = leadWorkFilter(filters);
  const disabled = pending || assignmentPending;
  const queryFor = (value: typeof view, scope?: "mine" | "all") => {
    const query = new URLSearchParams(leadWorkFilterQuery(filters, value, scope));
    if (fieldQuery) query.set("fields", fieldQuery);
    return query.toString();
  };
  const options = LEAD_WORK_FILTERS.filter(value => value === "unassigned" ? canScopeAll || filters.scope === "unassigned" : value !== "all" || canScopeAll)
    .map(value => ({ value, label: filterT(`leads_${value}`) }));
  return <>
    <FollowupPrimaryFilter label={filterT("workQueue")} value={!canScopeAll && view === "all" ? "assigned" : view} disabled={disabled || options.length < 2}
      options={options}
      onValueChange={value => startTransition(() => router.replace(`/dashboard/followups/leads?${queryFor(value as typeof view)}`))} />
    {canScopeAll ? <FollowupChoice label={t("scopeLabel")} value={filters.scope === "mine" ? "mine" : "all"}
      presentation="select" disabled={disabled || view === "unassigned"} className="h-8 min-h-8 w-28 shrink-0 py-1 text-xs"
      options={[{ value: "all", label: filterT("allOwners") }, { value: "mine", label: t("scopeMine") }]}
      onValueChange={scope => startTransition(() => router.replace(`/dashboard/followups/leads?${queryFor(view, scope as "mine" | "all")}`))} /> : null}
  </>;
}

"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import { FollowupPrimaryFilter } from "./FollowupPrimaryFilter";
import { LEAD_WORK_FILTERS, leadWorkFilter, leadWorkFilterQuery } from "./followup-primary-filter-contract";
import { useLeadPoolSelection } from "./LeadPoolSelection";
import type { LeadPoolFilters } from "./lead-contract";

/** 全库范围切换回到第一页；列筛选仍只作用于已加载页。 */
export function LeadIntakeScopeFilter({ filters, canScopeAll }: { filters: LeadPoolFilters; canScopeAll: boolean }) {
  const t = useTranslations("school.leads");
  const filterT = useTranslations("school.followupFilters");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { assignmentPending } = useLeadPoolSelection();
  const view = leadWorkFilter(filters);
  const disabled = pending || assignmentPending;
  const options = LEAD_WORK_FILTERS.filter(value => value === "unassigned" ? canScopeAll || filters.scope === "unassigned" : value !== "all" || canScopeAll)
    .map(value => ({ value, label: filterT(`leads_${value}`) }));
  return <>
    <FollowupPrimaryFilter label={filterT("workQueue")} value={!canScopeAll && view === "all" ? "assigned" : view} disabled={disabled || options.length < 2}
      options={options}
      onValueChange={value => startTransition(() => router.replace(`/dashboard/followups/leads?${leadWorkFilterQuery(filters, value as typeof view)}`))} />
    {canScopeAll ? <FollowupChoice label={t("scopeLabel")} value={filters.scope === "mine" ? "mine" : "all"}
      presentation="select" disabled={disabled || view === "unassigned"} className="h-8 min-h-8 w-28 shrink-0 py-1 text-xs"
      options={[{ value: "all", label: filterT("allOwners") }, { value: "mine", label: t("scopeMine") }]}
      onValueChange={scope => startTransition(() => router.replace(`/dashboard/followups/leads?${leadWorkFilterQuery(filters, view, scope as "mine" | "all")}`))} /> : null}
  </>;
}

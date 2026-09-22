"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { schoolCollaborationMessages, schoolSupportGroupFilter, type SchoolCollaborationSettings } from "./school-collaboration-contract";
import type { DashboardFieldQuery } from "./dashboard-page/dashboard-table-field-contract";
import { useRouter } from "@/i18n/navigation";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import { FollowupPrimaryFilter } from "./FollowupPrimaryFilter";
import { LEAD_WORK_FILTERS, leadWorkFilter, leadWorkFilterQuery } from "./followup-primary-filter-contract";
import { useLeadPoolSelection } from "./LeadPoolSelection";
import type { LeadPoolFilters } from "./lead-contract";

/** 业务范围切换回到第一页，保留分页前执行的字段条件。 */
export function LeadIntakeScopeFilter({ filters, fieldQuery, groups = [] }: { filters: LeadPoolFilters; canScopeAll: boolean; fieldQuery?: string; groups?: SchoolCollaborationSettings["groups"] }) {
  const m = schoolCollaborationMessages(useLocale());
  const filterT = useTranslations("school.followupFilters");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { assignmentPending } = useLeadPoolSelection();
  const view = leadWorkFilter(filters);
  const disabled = pending || assignmentPending;
  const fields: DashboardFieldQuery = fieldQuery ? JSON.parse(fieldQuery) : { version: 2, filters: {}, sort: null };
  const group = fields.filters.group;
  const queryFor = (value: typeof view, scope?: "mine" | "all" | "group") => {
    const query = new URLSearchParams(leadWorkFilterQuery(filters, value, scope));
    if (fieldQuery) query.set("fields", fieldQuery);
    return query.toString();
  };
  const options = LEAD_WORK_FILTERS.map(value => ({ value, label: filterT(`leads_${value}`) }));
  return <>
    <FollowupPrimaryFilter label={filterT("workQueue")} value={view} disabled={disabled}
      options={options}
      onValueChange={value => startTransition(() => router.replace(`/dashboard/leads?${queryFor(value as typeof view)}`))} />
    <FollowupPrimaryFilter label={m.supportGroup} value={group?.kind === "enum" && group.values.length === 1 ? group.values[0] : "all"}
      disabled={disabled} options={[{ value: "all", label: m.allSupportGroups }, ...groups.map(group => ({ value: group.id, label: group.name }))]}
      onValueChange={value => { const query = new URLSearchParams(queryFor(view)); query.set("fields", JSON.stringify(schoolSupportGroupFilter(fields, value)));
        startTransition(() => router.replace(`/dashboard/leads?${query.toString()}`)); }} />
    <FollowupChoice label={m.scope} value={filters.scope === "mine" || filters.scope === "group" ? filters.scope : "all"}
      presentation="select" disabled={disabled || view === "unassigned"} className="h-8 min-h-8 w-28 shrink-0 py-1 text-xs"
      options={[{ value: "all", label: m.all }, { value: "mine", label: m.mine }, { value: "group", label: m.group }]}
      onValueChange={scope => startTransition(() => router.replace(`/dashboard/leads?${queryFor(view, scope as "mine" | "all" | "group")}`))} />
  </>;
}

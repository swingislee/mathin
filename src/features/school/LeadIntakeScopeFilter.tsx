"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import { useLeadPoolSelection } from "./LeadPoolSelection";
import type { LeadPoolFilters } from "./lead-contract";

/** 全库范围切换回到第一页；列筛选仍只作用于已加载页。 */
export function LeadIntakeScopeFilter({ filters, canScopeAll }: { filters: LeadPoolFilters; canScopeAll: boolean }) {
  const t = useTranslations("school.leads");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { assignmentPending } = useLeadPoolSelection();
  const options = [
    ...(canScopeAll || filters.scope === "unassigned" ? [{ value: "unassigned", label: t("scopeUnassigned") }] : []),
    { value: "mine", label: t("scopeMine") },
    ...(canScopeAll ? [{ value: "all", label: t("scopeAll") }] : []),
  ];
  return <FollowupChoice label={t("scopeLabel")} value={filters.scope} options={options}
    disabled={pending || assignmentPending || options.length < 2} className="min-h-8 w-28 text-xs"
    onValueChange={scope => {
      const query = new URLSearchParams({ scope, pageSize: String(filters.pageSize) });
      if (filters.status) query.set("status", filters.status);
      if (filters.q) query.set("q", filters.q);
      startTransition(() => router.replace(`/dashboard/followups/leads?${query}`));
    }} />;
}

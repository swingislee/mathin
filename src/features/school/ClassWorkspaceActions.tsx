"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Ellipsis } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from "@/i18n/navigation";
import { classWorkHref, workEntryMessages, type ClassWorkView, type WorkEntryQuery } from "./work-entry-contract";

/** 班级主体连续办理；统计、筛选、建班与辅助管理放入更多操作。 */
export function ClassWorkspaceActions({ canTeach, query, canCreateClass = false, filters, filtered = false }: {
  canTeach: boolean; query: WorkEntryQuery; canCreateClass?: boolean; filters?: ReactNode; filtered?: boolean;
}) {
  const m = workEntryMessages(useLocale());
  const t = useTranslations("school.enrollmentWorkflow");
  const views: ClassWorkView[] = [...(canTeach ? ["progress", "tasks"] as const : []), "directory"];
  return <Popover><PopoverTrigger asChild><Button variant="ghost" size="sm" className="relative size-8 p-0" aria-label={filtered ? `${m.classActions} · ${m.filteredRoster}` : m.classActions} title={m.classActions}><Ellipsis className="size-4" aria-hidden />{filtered ? <span aria-hidden className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-rose" /> : null}</Button></PopoverTrigger>
    <PopoverContent align="end" className={filters ? "w-80 max-w-[calc(100vw-2rem)] space-y-3 p-3" : "w-44 p-1"}>
      {filters ? <section aria-label={m.rosterFilters} className="space-y-2"><p className="text-xs font-medium">{m.rosterFilters}</p>{filters}</section> : null}
      <nav aria-label={m.classActions} className="flex flex-col">
      {canCreateClass ? <Link href="/dashboard/classes/new" className={buttonVariants({ variant: "ghost", size: "sm", className: "justify-start" })}>{t("createClass")}</Link> : null}
      {views.map(view => <Link key={view} href={classWorkHref(view, query)} className={buttonVariants({ variant: "ghost", size: "sm", className: "justify-start" })}>{m[view]}</Link>)}
    </nav></PopoverContent>
  </Popover>;
}

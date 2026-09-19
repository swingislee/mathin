"use client";

import { useLocale } from "next-intl";
import { DashboardCommandTabs } from "./dashboard-page/DashboardCommandTabs";
import { classWorkHref, workEntryMessages, type ClassWorkView, type WorkEntryQuery } from "./work-entry-contract";

export function ClassWorkspaceTabs({ active, canTeach, query }: { active: ClassWorkView; canTeach: boolean; query?: WorkEntryQuery }) {
  const locale = useLocale();
  const m = workEntryMessages(locale);
  const values = query ?? {};
  const views: ClassWorkView[] = ["arrange", ...(canTeach ? ["records", "progress"] as const : []), ...(active === "directory" ? ["directory"] as const : [])];
  return <DashboardCommandTabs ariaLabel={m.classes} activeValue={active === "tasks" ? "progress" : active} activeTone="accent"
    items={views.map(view => ({ value: view, label: m[view], href: classWorkHref(view, values) }))} />;
}

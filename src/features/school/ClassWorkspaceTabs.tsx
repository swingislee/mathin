"use client";

import { useLocale } from "next-intl";
import { DashboardCommandTabs } from "./dashboard-page/DashboardCommandTabs";
import { classWorkHref, workEntryMessages, type ClassWorkView, type WorkEntryQuery } from "./work-entry-contract";

export function ClassWorkspaceTabs({ active, query }: { active: ClassWorkView; canTeach: boolean; query?: WorkEntryQuery }) {
  const locale = useLocale();
  const m = workEntryMessages(locale);
  const values = query ?? {};
  if (active === "arrange" || active === "records") return null;
  return <DashboardCommandTabs ariaLabel={m.classes} activeValue={active} activeTone="accent"
    items={[{ value: "arrange", label: m.classes, href: classWorkHref("arrange", values) }, { value: active, label: m[active], href: classWorkHref(active, values) }]} />;
}

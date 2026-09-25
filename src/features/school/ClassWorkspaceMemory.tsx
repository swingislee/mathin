"use client";

import { useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { DashboardPage } from "./dashboard-page/DashboardPage";
import { useDashboardPreference } from "./dashboard-page/DashboardPreferenceScope";
import { CLASS_WORKSPACE_PREFERENCE, classWorkspacePreference, rememberedClassWorkspaceHref } from "./class-workspace-preferences";
import { workEntryMessages, type WorkEntryQuery } from "./work-entry-contract";

/** 空入口先恢复该账号的选择，再加载目标视图，避免覆盖上次偏好。 */
export function ClassWorkspaceEntry() {
  const preference = useDashboardPreference(CLASS_WORKSPACE_PREFERENCE);
  const router = useRouter();
  const href = rememberedClassWorkspaceHref(preference.raw);
  const locale = useLocale();
  const t = useTranslations("school.teachingWorkbench");
  useEffect(() => { if (preference.ready) router.replace(href); }, [href, preference.ready, router]);
  return <DashboardPage title={workEntryMessages(locale).classes} density="compact"><p role="status" className="py-8 text-sm text-muted">{t("loading")}</p></DashboardPage>;
}

export function ClassWorkspaceMemory({ query }: { query: WorkEntryQuery }) {
  const { ready, raw, save } = useDashboardPreference(CLASS_WORKSPACE_PREFERENCE);
  const selected = classWorkspacePreference(query);
  useEffect(() => {
    if (ready && selected !== null && raw !== JSON.stringify(selected)) save(selected);
  }, [ready, raw, save, selected]);
  return null;
}

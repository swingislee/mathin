"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useDashboardPreference } from "./dashboard-page/DashboardPreferenceScope";
import { rememberedTeacherWorkspaceHref, teacherWorkspaceLocation, type TeacherWorkspace } from "./teacher-workspace-contract";

/** 复用按账号隔离的展示偏好；进入页面即记录，刷新或关闭浏览器后可继续。 */
export function TeacherWorkspaceMemory() {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const location = teacherWorkspaceLocation(pathname, query);
  const { ready, raw, save } = useDashboardPreference(location ? `workspace-entry:${location.workspace}` : undefined);
  const href = location?.href;
  useEffect(() => {
    if (ready && href && raw !== JSON.stringify(href)) save(href);
  }, [ready, href, raw, save]);
  return null;
}

/** 裸入口先读本人上次位置；带明确阶段或筛选的链接直接显示所请求页面。 */
export function TeacherWorkspaceEntry({ workspace }: { workspace: TeacherWorkspace }) {
  const router = useRouter();
  const { ready, raw } = useDashboardPreference(`workspace-entry:${workspace}`);
  const href = rememberedTeacherWorkspaceHref(workspace, raw);
  useEffect(() => { if (ready) router.replace(href); }, [ready, href, router]);
  return <div aria-hidden className="space-y-4 py-8">
    <div className="h-10 animate-pulse rounded-lg bg-line/20" />
    <div className="h-64 animate-pulse rounded-xl bg-line/20" />
  </div>;
}

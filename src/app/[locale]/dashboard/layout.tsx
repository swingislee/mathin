import { cookies } from "next/headers";
import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";
import { DashboardShell } from "@/features/school/DashboardShell";
import { DashboardPreferenceScope } from "@/features/school/dashboard-page/DashboardPreferenceScope";
import { DASHBOARD_SIDEBAR_COOKIE, DASHBOARD_SIDEBAR_WIDTH_COOKIE, parseDashboardSidebarPreference } from "@/features/school/dashboard-sidebar";
import { getMyStudents } from "@/features/school/customer";
import { filterSchoolNav, HOME_NAV_ITEM, PARENT_NAV_ITEMS, STUDENT_NAV_ITEMS, type SchoolNavItem } from "@/features/school/nav";
import { isFeatureEnabled } from "@/features/school/organization-settings";
import { getActiveEnvironment, getMyPerms, requireUser } from "@/lib/auth";
import { isTeacherWorkspaceViewer } from "@/features/school/teacher-workspace";
import { TeacherWorkspaceMemory } from "@/features/school/TeacherWorkspaceMemory";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser(locale, { allowAccountRecovery: true });
  // 宽度和显隐参与首帧布局，刷新后直接恢复上次偏好。
  const cookieStore = await cookies();
  const sidebarPreference = parseDashboardSidebarPreference(
    cookieStore.get(DASHBOARD_SIDEBAR_COOKIE)?.value,
    cookieStore.get(DASHBOARD_SIDEBAR_WIDTH_COOKIE)?.value,
  );
  // P4I-1：左侧导航跟渲染在下面的 Home 一样按"当前使用环境"分派，不再直接认
  // profiles.role——员工兼家长切换到家庭视角时，导航也要跟着换成家庭导航。
  // doc22 §10：与页面级 requireDashboardEnvironment 共用同一个（每请求缓存的）判定。
  const active = await getActiveEnvironment(user.id);
  const rememberTeacherWorkspace = active === "staff" && await isTeacherWorkspaceViewer(user.id);

  let nav: readonly SchoolNavItem[] = [HOME_NAV_ITEM];
  if (active === "staff") {
    nav = filterSchoolNav(await getMyPerms(user.id));
  } else if (active === "family" || active === "learning") {
    const bound = (await safe(getMyStudents, [])).length > 0;
    if (bound) {
      const financeEnabled = active === "family" && await safe(() => isFeatureEnabled("finance.enabled"), false);
      nav = active === "learning" ? STUDENT_NAV_ITEMS : PARENT_NAV_ITEMS.filter((item) => item.href !== "/dashboard/finance" || financeEnabled);
    }
  }

  return (
    // 唯一滚动区 = 主内容：外框 h-dvh + overflow-hidden 锁死 window 滚动（P4C-0 §3.1）
    <div className="flex h-screen h-dvh flex-col overflow-hidden">
      <SiteHeader workspace />
      <DashboardPreferenceScope userId={user.id}>
        {rememberTeacherWorkspace ? <Suspense fallback={null}><TeacherWorkspaceMemory /></Suspense> : null}
        <DashboardShell nav={nav} initialSidebarPreference={sidebarPreference}>{children}</DashboardShell>
      </DashboardPreferenceScope>
    </div>
  );
}

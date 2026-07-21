import { setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";
import { DashboardShell } from "@/features/school/DashboardShell";
import { getMyStudents } from "@/features/school/customer";
import { filterSchoolNav, HOME_NAV_ITEM, PARENT_NAV_ITEMS, STUDENT_NAV_ITEMS, type SchoolNavItem } from "@/features/school/nav";
import { getMyPerms, getProfile, requireUser } from "@/lib/auth";
import { pickActiveEnvironment, resolveAvailableEnvironments } from "@/lib/environment";
import { createClient } from "@/lib/supabase/server";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function DashboardLayout({
  children,
  modal,
  params,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const profile = await getProfile(user.id);
  const supabase = await createClient();
  const available = await resolveAvailableEnvironments(supabase, user.id, profile?.role);
  // P4I-1：左侧导航跟渲染在下面的 Home 一样按"当前使用环境"分派，不再直接认
  // profiles.role——员工兼家长切换到家庭视角时，导航也要跟着换成家庭导航。
  const active = pickActiveEnvironment(profile?.lastActiveEnvironment, available);

  let nav: readonly SchoolNavItem[] = [HOME_NAV_ITEM];
  if (active === "staff") {
    nav = filterSchoolNav(await getMyPerms(user.id));
  } else if (active === "family" || active === "learning") {
    const bound = (await safe(getMyStudents, [])).length > 0;
    if (bound) nav = active === "learning" ? STUDENT_NAV_ITEMS : PARENT_NAV_ITEMS;
  }

  return (
    // 唯一滚动区 = 主内容：外框 h-dvh + overflow-hidden 锁死 window 滚动（P4C-0 §3.1）
    <div className="flex h-screen h-dvh flex-col overflow-hidden">
      <div className="shrink-0 border-b border-line">
        <SiteHeader />
      </div>
      <DashboardShell nav={nav}>{children}</DashboardShell>
      {modal}
    </div>
  );
}

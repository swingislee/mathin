import { setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";
import { DashboardShell } from "@/features/school/DashboardShell";
import { getMyStudents } from "@/features/school/customer";
import { filterSchoolNav, HOME_NAV_ITEM, PARENT_NAV_ITEMS, STUDENT_NAV_ITEMS, type SchoolNavItem } from "@/features/school/nav";
import { getMyPerms, getProfile, requireUser } from "@/lib/auth";

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
  const user = await requireUser(locale);
  const profile = await getProfile(user.id);
  const isStaff = profile?.role === "staff" || profile?.role === "admin";

  let nav: readonly SchoolNavItem[] = [HOME_NAV_ITEM];
  if (isStaff) {
    nav = filterSchoolNav(await getMyPerms(user.id));
  } else if (profile?.role === "student" || profile?.role === "parent") {
    const bound = (await safe(getMyStudents, [])).length > 0;
    if (bound) nav = profile.role === "student" ? STUDENT_NAV_ITEMS : PARENT_NAV_ITEMS;
  }

  return (
    // 唯一滚动区 = 主内容：外框 h-dvh + overflow-hidden 锁死 window 滚动（P4C-0 §3.1）
    <div className="flex h-screen h-dvh flex-col overflow-hidden">
      <div className="shrink-0 border-b border-line">
        <SiteHeader />
      </div>
      <DashboardShell nav={nav}>{children}</DashboardShell>
    </div>
  );
}

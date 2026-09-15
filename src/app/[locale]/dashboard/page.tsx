import { cookies } from "next/headers";
import { setRequestLocale } from "next-intl/server";
import {
  hasStaffHomeManagementScope,
  resolveStaffHomeView,
  STAFF_HOME_VIEW_COOKIE,
  STAFF_OVERVIEW_GRAIN_COOKIE,
  STAFF_OVERVIEW_DATE_COOKIE,
} from "@/features/school/home/staff-home-contract";
import { normalizeOverviewGrain } from "@/features/school/home/staff-overview-contract";
import { listMyWorkItems } from "@/features/school/work-items";
import { getActiveEnvironment, getMyPerms, getProfile, requireUser } from "@/lib/auth";

async function safeListMyWorkItems() {
  try {
    return await listMyWorkItems();
  } catch {
    return [];
  }
}

// 首屏按角色分派到三个自包含的 server component（P4G-7：原 1243 行巨石拆分）。
// 鉴权闸门 requireUser 单独最前置；各角色组件自取所需数据——staff 不再白取
// bests/recentPosts/classrooms（那三项只有客户/学生首屏用）。
//
// P4I-1：分派依据从单一 profiles.role 硬分支，改为"账号可用环境集合 + 偏好"
// （src/lib/environment.ts）。同一账号可能同时属于多个环境（例如 staff 账号
// 也是某个学生的监护人），此时按 last_active_environment 落地，不强行只认一个角色。
export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    focus?: string | string[];
    period?: string | string[];
    date?: string | string[];
    view?: string | string[];
  }>;
}) {
  const [{ locale }, rawSearchParams] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const focusTarget = typeof rawSearchParams.focus === "string" && rawSearchParams.focus.length <= 200
    ? rawSearchParams.focus
    : undefined;
  const requestedView = typeof rawSearchParams.view === "string" ? rawSearchParams.view : undefined;
  const user = await requireUser(locale);
  const profile = await getProfile(user.id);
  if (!profile) {
    const { StudentHome } = await import("@/features/school/home/StudentHome");
    return <StudentHome locale={locale} user={user} profile={profile} />;
  }

  const active = await getActiveEnvironment(user.id);

  if (active === "staff") {
    const workItems = safeListMyWorkItems();
    const [perms, cookieStore] = await Promise.all([
      getMyPerms(user.id),
      cookies(),
    ]);
    const view = resolveStaffHomeView({
      requested: requestedView,
      remembered: cookieStore.get(STAFF_HOME_VIEW_COOKIE)?.value,
      hasManagementScope: hasStaffHomeManagementScope(perms),
    });
    const period = normalizeOverviewGrain(typeof rawSearchParams.period === "string"
      ? rawSearchParams.period : cookieStore.get(STAFF_OVERVIEW_GRAIN_COOKIE)?.value ?? "month");
    const date = (typeof rawSearchParams.date === "string"
      ? rawSearchParams.date : cookieStore.get(STAFF_OVERVIEW_DATE_COOKIE)?.value ?? "current").slice(0, 20);
    if (view === "work") {
      const { TodayWorkHome } = await import("@/features/school/home/TodayWorkHome");
      return (
        <TodayWorkHome
          locale={locale}
          user={user}
          profile={profile}
          focusTarget={focusTarget}
          items={await workItems}
          perms={perms}
          overviewGrain={period}
          overviewDate={date}
        />
      );
    }
    const { StaffFactOverviewHome } = await import("@/features/school/home/StaffFactOverviewHome");
    return (
      <StaffFactOverviewHome
        locale={locale}
        user={user}
        profile={profile}
        focusTarget={focusTarget}
        grain={period}
        date={date}
        workItemCount={workItems.then(items => items.length)}
        organizationScope={perms.has("organization.settings.manage")}
      />
    );
  }
  if (active === "family") {
    const { ParentHome } = await import("@/features/school/home/ParentHome");
    return <ParentHome locale={locale} user={user} profile={profile} />;
  }
  const { StudentHome } = await import("@/features/school/home/StudentHome");
  return <StudentHome locale={locale} user={user} profile={profile} />;
}

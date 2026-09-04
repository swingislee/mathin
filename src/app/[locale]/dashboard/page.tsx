import { cookies } from "next/headers";
import { setRequestLocale } from "next-intl/server";
import { ParentHome } from "@/features/school/home/ParentHome";
import { StaffFactOverviewHome } from "@/features/school/home/StaffFactOverviewHome";
import { StudentHome } from "@/features/school/home/StudentHome";
import { TodayWorkHome } from "@/features/school/home/TodayWorkHome";
import {
  hasStaffHomeManagementScope,
  resolveStaffHomeView,
  STAFF_HOME_VIEW_COOKIE,
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
    view?: string | string[];
  }>;
}) {
  const [{ locale }, rawSearchParams] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const focusTarget = typeof rawSearchParams.focus === "string" && rawSearchParams.focus.length <= 200
    ? rawSearchParams.focus
    : undefined;
  const period = normalizeOverviewGrain(typeof rawSearchParams.period === "string" ? rawSearchParams.period : undefined);
  const requestedView = typeof rawSearchParams.view === "string" ? rawSearchParams.view : undefined;
  const user = await requireUser(locale);
  const profile = await getProfile(user.id);
  if (!profile) return <StudentHome locale={locale} user={user} profile={profile} />;

  const active = await getActiveEnvironment(user.id);

  if (active === "staff") {
    const [perms, workItems, cookieStore] = await Promise.all([
      getMyPerms(user.id),
      safeListMyWorkItems(),
      cookies(),
    ]);
    const view = resolveStaffHomeView({
      requested: requestedView,
      remembered: cookieStore.get(STAFF_HOME_VIEW_COOKIE)?.value,
      hasManagementScope: hasStaffHomeManagementScope(perms),
    });
    if (view === "work") {
      return (
        <TodayWorkHome
          locale={locale}
          user={user}
          profile={profile}
          focusTarget={focusTarget}
          items={workItems}
          perms={perms}
        />
      );
    }
    return (
      <StaffFactOverviewHome
        locale={locale}
        user={user}
        profile={profile}
        focusTarget={focusTarget}
        grain={period}
        workItemCount={workItems.length}
      />
    );
  }
  if (active === "family") return <ParentHome locale={locale} user={user} profile={profile} />;
  return <StudentHome locale={locale} user={user} profile={profile} />;
}

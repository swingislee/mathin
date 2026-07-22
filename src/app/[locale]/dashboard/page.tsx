import { setRequestLocale } from "next-intl/server";
import { ParentHome } from "@/features/school/home/ParentHome";
import { StudentHome } from "@/features/school/home/StudentHome";
import { TodayWorkHome } from "@/features/school/home/TodayWorkHome";
import { getProfile, requireUser } from "@/lib/auth";
import { pickActiveEnvironment, resolveAvailableEnvironments } from "@/lib/environment";
import { createClient } from "@/lib/supabase/server";

// 首屏按角色分派到三个自包含的 server component（P4G-7：原 1243 行巨石拆分）。
// 鉴权闸门 requireUser 单独最前置；各角色组件自取所需数据——staff 不再白取
// bests/recentPosts/classrooms（那三项只有客户/学生首屏用）。
//
// P4I-1：分派依据从单一 profiles.role 硬分支，改为"账号可用环境集合 + 偏好"
// （src/lib/environment.ts）。同一账号可能同时属于多个环境（例如 staff 账号
// 也是某个学生的监护人），此时按 last_active_environment 落地，不强行只认一个角色。
export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const profile = await getProfile(user.id);
  if (!profile) return <StudentHome locale={locale} user={user} profile={profile} />;

  const supabase = await createClient();
  const available = await resolveAvailableEnvironments(supabase, user.id, profile.role);
  const active = pickActiveEnvironment(profile.lastActiveEnvironment, available);

  if (active === "staff") return <TodayWorkHome locale={locale} user={user} profile={profile} />;
  if (active === "family") return <ParentHome locale={locale} user={user} profile={profile} />;
  return <StudentHome locale={locale} user={user} profile={profile} />;
}

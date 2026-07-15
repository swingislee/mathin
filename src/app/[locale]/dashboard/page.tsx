import { setRequestLocale } from "next-intl/server";
import { ParentHome } from "@/features/school/home/ParentHome";
import { StaffHome } from "@/features/school/home/StaffHome";
import { StudentHome } from "@/features/school/home/StudentHome";
import { getProfile, requireUser } from "@/lib/auth";

// 首屏按角色分派到三个自包含的 server component（P4G-7：原 1243 行巨石拆分）。
// 鉴权闸门 requireUser 单独最前置；各角色组件自取所需数据——staff 不再白取
// bests/recentPosts/classrooms（那三项只有客户/学生首屏用）。
export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const profile = await getProfile(user.id);

  if (profile?.role === "staff" || profile?.role === "admin") {
    return <StaffHome locale={locale} user={user} profile={profile} />;
  }
  if (profile?.role === "parent") {
    return <ParentHome locale={locale} user={user} profile={profile} />;
  }
  return <StudentHome locale={locale} user={user} profile={profile} />;
}

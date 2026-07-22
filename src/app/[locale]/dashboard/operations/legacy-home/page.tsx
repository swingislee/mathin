import { setRequestLocale } from "next-intl/server";
import { StaffHome } from "@/features/school/home/StaffHome";
import { getProfile, requirePerm } from "@/lib/auth";

// P4I-17：旧磁贴首页只读对账视图，仅 `audit.view` 持有者可见——这不是员工
// 日常入口，只是用来核对今日工作的新数量与旧磁贴是否一致，P4I-19 会整体删除。
export default async function LegacyStaffHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requirePerm(locale, "audit.view");
  const profile = await getProfile(user.id);
  return <StaffHome locale={locale} user={user} profile={profile} />;
}

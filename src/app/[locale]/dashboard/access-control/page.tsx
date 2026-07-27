import { getTranslations, setRequestLocale } from "next-intl/server";
import { DashboardPage } from "@/features/school/dashboard-page";
import { RolesMatrixPanel } from "@/features/school/RolesMatrixPanel";
import { listStaffRoles } from "@/features/school/staff";
import { getProfile, requirePerm } from "@/lib/auth";

// doc22 §5.23：岗位权限是不依赖具体员工的独立配置控制台，与 /dashboard/staff 同级。
// 原 /dashboard/staff/roles 用 URL 嵌套制造了伪父子关系，返回链接与面包屑随之删除。
export default async function AccessControlPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requirePerm(locale, "permission.configure");
  const [t, profile, roles] = await Promise.all([
    getTranslations("school.roles"),
    getProfile(user.id),
    listStaffRoles(),
  ]);

  return (
    <DashboardPage title={t("title")}>
      <RolesMatrixPanel roles={roles} isAdmin={profile?.role === "admin"} />
    </DashboardPage>
  );
}

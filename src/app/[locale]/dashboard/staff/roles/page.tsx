import { getTranslations, setRequestLocale } from "next-intl/server";
import { DashboardPage } from "@/features/school/dashboard-page";
import { RolesMatrixPanel } from "@/features/school/RolesMatrixPanel";
import { listStaffRoles } from "@/features/school/staff";
import { getProfile, requirePerm } from "@/lib/auth";

export default async function StaffRolesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requirePerm(locale, "permission.configure");
  const [t, tStaff, profile, roles] = await Promise.all([
    getTranslations("school.roles"),
    getTranslations("school.staff"),
    getProfile(user.id),
    listStaffRoles(),
  ]);

  return (
    <DashboardPage
      title={t("title")}
      backHref="/dashboard/staff"
      backLabel={tStaff("back")}
      breadcrumbs={[{ label: tStaff("title"), href: "/dashboard/staff" }, { label: t("title") }]}
    >
      <RolesMatrixPanel roles={roles} isAdmin={profile?.role === "admin"} />
    </DashboardPage>
  );
}

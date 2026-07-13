import { getTranslations, setRequestLocale } from "next-intl/server";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { RolesMatrixPanel } from "@/features/school/RolesMatrixPanel";
import { listStaffRoles } from "@/features/school/staff";
import { getProfile, requirePerm } from "@/lib/auth";

export default async function StaffRolesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requirePerm(locale, "permission.configure");
  const [t, profile, roles] = await Promise.all([
    getTranslations("school.roles"),
    getProfile(user.id),
    listStaffRoles(),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <SchoolPageHeader title={t("title")}>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("intro")}</p>
      </SchoolPageHeader>
      <div className="mt-6">
        <RolesMatrixPanel roles={roles} isAdmin={profile?.role === "admin"} />
      </div>
    </div>
  );
}

import { getTranslations, setRequestLocale } from "next-intl/server";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { StaffMembersPanel } from "@/features/school/StaffMembersPanel";
import { listStaffMembers, listStaffRoles } from "@/features/school/staff";
import { getProfile, requirePerm } from "@/lib/auth";

export default async function StaffPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requirePerm(locale, "staff.manage");
  const [t, profile, members, roles] = await Promise.all([
    getTranslations("school.staff"),
    getProfile(user.id),
    listStaffMembers(),
    listStaffRoles(),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <SchoolPageHeader title={t("title")}>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("intro")}</p>
      </SchoolPageHeader>
      <div className="mt-6">
        <StaffMembersPanel members={members} roles={roles} selfId={user.id} isAdmin={profile?.role === "admin"} />
      </div>
    </div>
  );
}

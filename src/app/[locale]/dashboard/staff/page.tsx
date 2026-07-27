import { getTranslations, setRequestLocale } from "next-intl/server";
import { DashboardPage } from "@/features/school/dashboard-page";
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
    <DashboardPage title={t("title")}>
      <StaffMembersPanel members={members} roles={roles} selfId={user.id} isAdmin={profile?.role === "admin"} />
    </DashboardPage>
  );
}

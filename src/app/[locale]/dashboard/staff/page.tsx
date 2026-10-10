import { getTranslations, setRequestLocale } from "next-intl/server";
import { DashboardPage, DashboardCommandPanel, DashboardCommandState, DashboardCommandTabs } from "@/features/school/dashboard-page";
import { StaffMembersPanel } from "@/features/school/StaffMembersPanel";
import { listRecentStaffImportBatches } from "@/features/school/staff-imports";
import { listStaffMembers, listStaffRoles } from "@/features/school/staff";
import { readSchoolCollaborationSettings } from "@/features/school/school-collaboration-data";
import { SchoolOrganizationBoard } from "@/features/school/SchoolOrganizationBoard";
import { schoolOrganizationMessages } from "@/features/school/school-organization-messages";
import { getMyPerms, getProfile, requireAnyPerm } from "@/lib/auth";

export default async function StaffPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ view?: string }>;
}) {
  const [{ locale }, { view }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ["staff.invite", "staff.manage", "student.view.all", "student.view.assigned", "followup.view"]);
  const [t, perms] = await Promise.all([getTranslations("school.staff"), getMyPerms(user.id)]);
  const canListStaff = perms.has("staff.invite") || perms.has("staff.manage");
  const organization = view === "organization" || !canListStaff;
  const om = schoolOrganizationMessages(locale);
  const tabs = canListStaff ? <DashboardCommandTabs ariaLabel={t("title")} activeValue={organization ? "organization" : "members"} items={[
    { value: "members", label: t("title"), href: "/dashboard/staff" },
    { value: "organization", label: om.tab, href: "/dashboard/staff?view=organization" },
  ]} /> : null;

  if (organization) {
    return <SchoolOrganizationBoard locale={locale} title={t("title")} tabs={tabs} initial={await readSchoolCollaborationSettings()} />;
  }
  const [profile, members, roles, recentImportBatches] = await Promise.all([
    getProfile(user.id), listStaffMembers(), listStaffRoles(), listRecentStaffImportBatches(),
  ]);
  return (
    <DashboardPage title={t("title")} commandPanel={<DashboardCommandPanel><DashboardCommandState>{tabs}</DashboardCommandState></DashboardCommandPanel>}>
      <StaffMembersPanel
        members={members}
        roles={roles}
        recentImportBatches={recentImportBatches}
        selfId={user.id}
        isAdmin={profile?.role === "admin"}
        canInviteStaff={perms.has("staff.invite")}
        canManageStaff={perms.has("staff.manage")}
      />
    </DashboardPage>
  );
}

import { getTranslations, setRequestLocale } from "next-intl/server";
import { DashboardPage, DashboardCommandPanel, DashboardCommandActions } from "@/features/school/dashboard-page";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { schoolCollaborationMessages } from "@/features/school/school-collaboration-contract";
import { StaffMembersPanel } from "@/features/school/StaffMembersPanel";
import { listRecentStaffImportBatches } from "@/features/school/staff-imports";
import { listStaffMembers, listStaffRoles } from "@/features/school/staff";
import { getMyPerms, getProfile, requireAnyPerm } from "@/lib/auth";

export default async function StaffPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ["staff.invite", "staff.manage"]);
  const [t, profile, perms, members, roles, recentImportBatches] = await Promise.all([
    getTranslations("school.staff"),
    getProfile(user.id),
    getMyPerms(user.id),
    listStaffMembers(),
    listStaffRoles(),
    listRecentStaffImportBatches(),
  ]);

  return (
    <DashboardPage title={t("title")} commandPanel={<DashboardCommandPanel><DashboardCommandActions>
      <Link href="/dashboard/staff/groups" className={buttonVariants({ size: "sm", variant: "ghost" })}>{schoolCollaborationMessages(locale).title}</Link>
    </DashboardCommandActions></DashboardCommandPanel>}>
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

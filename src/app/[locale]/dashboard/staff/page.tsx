import { setRequestLocale } from "next-intl/server";
import { listRecentStaffImportBatches } from "@/features/school/staff-imports";
import { listStaffMembers, listStaffRoles } from "@/features/school/staff";
import { readSchoolCollaborationSettings } from "@/features/school/school-collaboration-data";
import { SchoolOrganizationBoard } from "@/features/school/SchoolOrganizationBoard";
import { getMyPerms, getProfile, requireAnyPerm } from "@/lib/auth";

/** 组织与分工：画板与名册共用一页；名册承担员工管理（岗位、密码、停用、批量与单独添加）。 */
export default async function StaffPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ["staff.invite", "staff.manage", "student.view.all", "student.view.assigned", "followup.view"]);
  const perms = await getMyPerms(user.id);
  const canListStaff = perms.has("staff.invite") || perms.has("staff.manage");
  const [settings, staffAdmin] = await Promise.all([
    readSchoolCollaborationSettings(),
    canListStaff ? Promise.all([getProfile(user.id), listStaffMembers(), listStaffRoles(), listRecentStaffImportBatches()])
      .then(([profile, members, roles, recentImportBatches]) => ({ members, roles, recentImportBatches, selfId: user.id, isAdmin: profile?.role === "admin",
        canInviteStaff: perms.has("staff.invite"), canManageStaff: perms.has("staff.manage") })) : Promise.resolve(undefined),
  ]);
  return <SchoolOrganizationBoard locale={locale} initial={settings} staffAdmin={staffAdmin} />;
}

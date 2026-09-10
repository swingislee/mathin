import { getNow, getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { PermissionKey } from "./permissions";
import { NewStudentDialog } from "./NewStudentDialog";
import { parseStudentStageFilters } from "./student-stage-contract";
import { loadStudentStageFieldPage } from "./student-stage-table-data";
import { studentStageFieldScope } from "./student-stage-table-fields";
import { StudentStageWorkspace } from "./StudentStageWorkspace";
import { getOrganizationTimezoneV2 } from "./organization-locations";
import { listStaffMembers } from "./staff";
import { readSchoolCollaborationSettings } from "./school-collaboration-data";
import { schoolCollaborationMessages } from "./school-collaboration-contract";

export async function StudentStagePage({ locale, currentUserId, permissions, searchParams }: {
  locale: string; currentUserId: string; permissions: Set<PermissionKey>; searchParams: Record<string, string | string[] | undefined>;
}) {
  const filters = parseStudentStageFilters(searchParams, permissions.has("student.view.all") ? "all" : "mine");
  const canAssign = permissions.has("student.assign");
  const pagePromise = Promise.all([getTranslations("school.students"), getOrganizationTimezoneV2(), canAssign ? listStaffMembers() : Promise.resolve([]), getNow(), readSchoolCollaborationSettings()])
    .then(async ([t, timeZone, staff, currentTime, collaboration]) => {
      const now = currentTime.getTime();
      return { t, timeZone, staff, now, collaboration, data: await loadStudentStageFieldPage(filters, { locale, timeZone, now }, currentUserId) };
    });
  const { t, timeZone, staff, now, data, collaboration } = await pagePromise;
  const resolvedFilters = { ...filters, scope: studentStageFieldScope(data.fieldView.query), detail: "", fields: JSON.stringify(data.fieldView.query) };
  return <StudentStageWorkspace data={data} filters={resolvedFilters} locale={locale} currentUserId={currentUserId}
    collaboration={collaboration}
    canPlan={permissions.has("followup.write") && permissions.has("followup.view")}
    canPlanOthers={canAssign && permissions.has("student.view.all")}
    canAssign={canAssign} assignees={staff.filter(member => member.isActive && member.canFollowUp).map(({ userId, displayName }) => ({ userId, displayName }))}
    canEnroll={permissions.has("enrollment.manage")} timeZone={timeZone} now={now} actions={<>
      <Link href="/dashboard/students/groups" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{schoolCollaborationMessages(locale).title}</Link>
      {!permissions.has("followup.write") && permissions.has("student.create") ? <NewStudentDialog /> : null}
      {permissions.has("student.import") ? <Link href="/dashboard/students/import" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{t("import")}</Link> : null}
      {permissions.has("student.delete") ? <Link href="/dashboard/students?tab=recycle" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{t("recycleBin")}</Link> : null}
    </>} />;
}

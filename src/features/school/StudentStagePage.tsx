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
import { listLeadPool } from "./leads";
import { listInvitationOptions } from "./invitations";
import { InvitationCoordinationWorkbench } from "./InvitationCoordinationWorkbench";
import { CommunicationWorkSelectionProvider } from "./CommunicationWorkSelection";
import { workEntryMessages } from "./work-entry-contract";

export async function StudentStagePage({ locale, currentUserId, permissions, searchParams, presentation = "students" }: {
  locale: string; currentUserId: string; permissions: Set<PermissionKey>; searchParams: Record<string, string | string[] | undefined>;
  presentation?: "students" | "communication";
}) {
  const filters = parseStudentStageFilters(searchParams, permissions.has("student.view.all") ? "all" : "mine");
  const canAssign = permissions.has("student.assign");
  const dataPromise = Promise.all([getOrganizationTimezoneV2(), getNow()]).then(async ([timeZone, currentTime]) => {
    const now = currentTime.getTime();
    return { timeZone, now, data: await loadStudentStageFieldPage(filters, { locale, timeZone, now }, currentUserId) };
  });
  const [t, staff, collaboration, { timeZone, now, data }] = await Promise.all([
    getTranslations("school.students"), canAssign ? listStaffMembers() : Promise.resolve([]), readSchoolCollaborationSettings(), dataPromise,
  ]);
  const resolvedFilters = { ...filters, scope: studentStageFieldScope(data.fieldView.query), detail: "", fields: JSON.stringify(data.fieldView.query) };
  const m = workEntryMessages(locale);
  let firstContactContent;
  if (presentation === "communication" && filters.population !== "recontact" && filters.stage === "awaiting_first_contact" && !filters.q) {
    const [{ leads }, options] = await Promise.all([
      listLeadPool(currentUserId, { scope: resolvedFilters.scope, page: 1, pageSize: filters.pageSize }, data.rows.flatMap(row => row.leadId ? [row.leadId] : [])),
      listInvitationOptions(),
    ]);
    const sessionKey = `communication-stages:${JSON.stringify(resolvedFilters)}`;
    firstContactContent = <CommunicationWorkSelectionProvider key={sessionKey}>
      <InvitationCoordinationWorkbench firstContactOnly sessionKey={sessionKey} rows={[]} contactLeads={leads} leadDetails={leads}
        historicalFirstContacts={data.rows.flatMap(row => !row.leadId && row.studentId ? [{ studentId: row.studentId, name: row.name, phone: row.phone, grade: row.grade, context: row.note }] : [])}
        rowOrder={data.rows.map(row => row.leadId ? `lead:${row.leadId}` : `student:${row.studentId}`)}
        activities={options.activities} assessors={options.assessors} locale={locale} currentUserId={currentUserId}
        canManageInvitation={permissions.has("followup.write")} canContact={permissions.has("followup.write")}
        canManageIdentity={permissions.has("followup.write") && permissions.has("student.edit")} timeZone={timeZone} now={now} />
    </CommunicationWorkSelectionProvider>;
  }
  return <StudentStageWorkspace data={data} filters={resolvedFilters} locale={locale} currentUserId={currentUserId}
    presentation={presentation} firstContactContent={firstContactContent}
    collaboration={collaboration}
    canPlan={permissions.has("followup.write") && permissions.has("followup.view")}
    canPlanOthers={canAssign && permissions.has("student.view.all")}
    canAssign={canAssign} assignees={staff.filter(member => member.isActive && member.canFollowUp).map(({ userId, displayName }) => ({ userId, displayName }))}
    canEnroll={permissions.has("enrollment.manage")} timeZone={timeZone} now={now} actions={presentation === "communication" ? <Link href="/dashboard/communication/worklists" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{m.worklists}</Link> : <>
      <Link href="/dashboard/students/groups" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{schoolCollaborationMessages(locale).title}</Link>
      {!permissions.has("followup.write") && permissions.has("student.create") ? <NewStudentDialog /> : null}
      {permissions.has("student.import") ? <Link href="/dashboard/students/import" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{t("import")}</Link> : null}
      {permissions.has("student.delete") ? <Link href="/dashboard/students?tab=recycle" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{t("recycleBin")}</Link> : null}
    </>} />;
}

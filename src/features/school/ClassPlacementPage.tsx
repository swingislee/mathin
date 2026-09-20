import { getNow, getTranslations, setRequestLocale } from "next-intl/server";
import { getOrganizationTimezoneV2 } from "@/features/school/organization-locations";
import { EnrollmentPlacementWorkbench } from "@/features/school/EnrollmentPlacementWorkbench";
import { enrollmentWorkflowRpc, loadEnrollmentPlacementBoard } from "@/features/school/enrollment-workflow-data";
import { getMyPerms, requireDashboardEnvironment } from "@/lib/auth";
import { redirect } from '@/i18n/navigation';
import { loadStudentBusinessHistory } from '@/features/school/student-business-history-data';
import { businessRecordStateFilter } from '@/features/school/business-record-state-contract';
import { isTeacherWorkspaceViewer } from "@/features/school/teacher-workspace";
import { DashboardCommandActions, DashboardEmptyCard, DashboardPage } from "@/features/school/dashboard-page";
import { FollowupCommandPanel } from "@/features/school/FollowupCommandPanel";
import { ClassWorkspaceActions } from "./ClassWorkspaceActions";
import { workEntryMessages, type WorkEntryQuery } from "./work-entry-contract";

export default async function CourseEnrollmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<WorkEntryQuery>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const { user } = await requireDashboardEnvironment(locale, ['staff']);
  const permissions = await getMyPerms(user.id);
  const canTeach = permissions.has("class.view.mine") || permissions.has("class.view.all");
  const m = workEntryMessages(locale);
  if (await enrollmentWorkflowRpc('can_access_enrollment_placement') !== true) {
    if (!await isTeacherWorkspaceViewer(user.id)) redirect({ locale, href: '/dashboard' });
    const t = await getTranslations("school.followupWorkspace");
    return <DashboardPage title={m.classes} density="compact" commandPanel={<FollowupCommandPanel>
      <DashboardCommandActions><ClassWorkspaceActions canTeach={canTeach} query={query} /></DashboardCommandActions>
    </FollowupCommandPanel>}><DashboardEmptyCard>{t("noTeachingClassForPlacement")}</DashboardEmptyCard></DashboardPage>;
  }
  const [board, timeZone, now] = await Promise.all([
    loadEnrollmentPlacementBoard(),
    getOrganizationTimezoneV2(), getNow(),
  ]);

  return (
    <EnrollmentPlacementWorkbench
      workspace="classes"
      canTeach={canTeach}
      workspaceQuery={query}
      focusClassroomId={typeof query.classroom === "string" ? query.classroom : undefined}
      initialBoard={board}
      timeZone={timeZone}
      now={now.getTime()}
      history={permissions.has('enrollment.manage') ? await loadStudentBusinessHistory(locale,{kind:'enrollment',projection:'workbench'}) : null}
      initialQuery={typeof query.q === "string" ? query.q.slice(0,100) : undefined}
      initialRecordState={businessRecordStateFilter(typeof query.state === "string" ? query.state : undefined)}
      initialTermId={typeof query.term === "string" ? query.term : undefined}
      focusStudentId={typeof query.student === "string" ? query.student : undefined}
      canCreateClass={permissions.has("class.create")}
      canAdd={permissions.has('enrollment.manage') && permissions.has("followup.write") && permissions.has("followup.view")}
    />
  );
}

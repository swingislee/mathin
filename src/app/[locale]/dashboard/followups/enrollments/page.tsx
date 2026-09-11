import { getNow, getTranslations, setRequestLocale } from "next-intl/server";
import { getOrganizationTimezoneV2 } from "@/features/school/organization-locations";
import { EnrollmentPlacementWorkbench } from "@/features/school/EnrollmentPlacementWorkbench";
import { enrollmentWorkflowRpc, loadEnrollmentPlacementBoard } from "@/features/school/enrollment-workflow-data";
import { getMyPerms, requireDashboardEnvironment } from "@/lib/auth";
import { redirect } from '@/i18n/navigation';
import { loadStudentBusinessHistory } from '@/features/school/student-business-history-data';
import { businessRecordStateFilter } from '@/features/school/business-record-state-contract';
import { isTeacherWorkspaceViewer } from "@/features/school/teacher-workspace";
import { DashboardCommandState, DashboardEmptyCard, DashboardPage } from "@/features/school/dashboard-page";
import { FollowupCommandPanel } from "@/features/school/FollowupCommandPanel";
import { FollowupTabs } from "@/features/school/FollowupTabs";

export default async function CourseEnrollmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ term?: string; student?: string; q?:string; state?:string }>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const { user } = await requireDashboardEnvironment(locale, ['staff']);
  if (await enrollmentWorkflowRpc('can_access_enrollment_placement') !== true) {
    if (!await isTeacherWorkspaceViewer(user.id)) redirect({ locale, href: '/dashboard' });
    const t = await getTranslations("school.followupWorkspace");
    return <DashboardPage title={t("enrollments")} density="compact" commandPanel={<FollowupCommandPanel>
      <DashboardCommandState><FollowupTabs /></DashboardCommandState>
    </FollowupCommandPanel>}><DashboardEmptyCard>{t("noTeachingClassForPlacement")}</DashboardEmptyCard></DashboardPage>;
  }
  const [board, permissions, timeZone, now] = await Promise.all([
    loadEnrollmentPlacementBoard(),
    getMyPerms(user.id),
    getOrganizationTimezoneV2(), getNow(),
  ]);

  return (
    <EnrollmentPlacementWorkbench
      initialBoard={board}
      timeZone={timeZone}
      now={now.getTime()}
      history={permissions.has('enrollment.manage') ? await loadStudentBusinessHistory(locale,{kind:'enrollment'}) : null}
      initialQuery={query.q?.slice(0,100)}
      initialRecordState={businessRecordStateFilter(query.state)}
      initialTermId={query.term}
      focusStudentId={query.student}
      canCreateClass={permissions.has("class.create")}
      canAdd={permissions.has('enrollment.manage') && permissions.has("followup.write") && permissions.has("followup.view")}
    />
  );
}

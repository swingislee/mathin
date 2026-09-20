import { getNow, getTranslations, setRequestLocale } from "next-intl/server";
import { getOrganizationTimezoneV2 } from "@/features/school/organization-locations";
import { EnrollmentPlacementWorkbench } from "@/features/school/EnrollmentPlacementWorkbench";
import { enrollmentWorkflowRpc, loadEnrollmentPlacementBoard } from "@/features/school/enrollment-workflow-data";
import { getMyPerms, requireDashboardEnvironment } from "@/lib/auth";
import { redirect } from '@/i18n/navigation';
import { loadStudentBusinessHistory } from '@/features/school/student-business-history-data';
import { isTeacherWorkspaceViewer } from "@/features/school/teacher-workspace";
import { DashboardEmptyCard, DashboardPage } from "@/features/school/dashboard-page";
import { ClassWorkspaceCommandPanel } from "./ClassWorkspaceCommandPanel";
import { getClassRosterSessions } from "./class-roster-session-read";
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
    return <DashboardPage title={m.classes} density="compact" commandPanel={<ClassWorkspaceCommandPanel
      actions={<ClassWorkspaceActions canTeach={canTeach} query={query} />}
    />}><DashboardEmptyCard>{t("noTeachingClassForPlacement")}</DashboardEmptyCard></DashboardPage>;
  }
  const [{ board, sessions, sessionsFailed }, timeZone, now, history] = await Promise.all([
    loadEnrollmentPlacementBoard().then(async board => {
      let sessionsFailed = false;
      const sessions = canTeach ? await getClassRosterSessions(board.options.classrooms.map(row => row.id))
        .catch(() => { sessionsFailed = true; return []; }) : [];
      return { board, sessions, sessionsFailed };
    }),
    getOrganizationTimezoneV2(), getNow(),
    permissions.has('enrollment.manage') ? loadStudentBusinessHistory(locale, { kind: 'enrollment', projection: 'workbench' }) : null,
  ]);
  const focusSessionId = typeof query.session === "string" ? query.session : undefined;
  const focusedSession = sessions.find(session => session.id === focusSessionId);
  const focusClassroomId = focusedSession?.classroomId ?? (typeof query.classroom === "string" ? query.classroom : undefined);
  const focusTermId = focusedSession ? board.options.classrooms.find(row => row.id === focusedSession.classroomId)?.termId : undefined;

  return (
    <EnrollmentPlacementWorkbench
      key={`${query.term ?? ""}:${query.student ?? ""}:${focusClassroomId ?? ""}:${focusSessionId ?? ""}`}
      workspace="classes"
      canTeach={canTeach}
      workspaceQuery={query}
      focusClassroomId={focusClassroomId}
      focusSessionId={focusSessionId}
      sessions={sessions}
      sessionsFailed={sessionsFailed}
      initialBoard={board}
      timeZone={timeZone}
      now={now.getTime()}
      history={history}
      initialQuery={typeof query.q === "string" ? query.q.slice(0,100) : undefined}
      initialTermId={focusTermId ?? (typeof query.term === "string" ? query.term : undefined)}
      focusStudentId={typeof query.student === "string" ? query.student : undefined}
      canCreateClass={permissions.has("class.create")}
      canAdd={permissions.has('enrollment.manage') && permissions.has("followup.write") && permissions.has("followup.view")}
    />
  );
}

import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { BindCodeForm } from "@/features/school/BindCodeForm";
import { getMyPendingAssignments, getMyPublishedVideoTasks, getMyStudents } from "@/features/school/customer";
import {
  DashboardCard,
  DashboardContentGrid,
  DashboardEmptyCard,
  DashboardMainColumn,
  DashboardPage,
} from "@/features/school/dashboard-page";
import { ManagedVideoUploadPanel } from "@/features/school/ManagedVideoUploadPanel";
import { Link } from "@/i18n/navigation";
import { requireDashboardEnvironment } from "@/lib/auth";
import { cn } from "@/lib/utils";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function AssignmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  await requireDashboardEnvironment(locale, ["learning", "family"]);
  const t = await getTranslations("school.customer");
  const myStudents = await safe(getMyStudents, []);
  const isBound = myStudents.length > 0;
  const [assignments, videoTasks] = isBound
    ? await Promise.all([safe(getMyPendingAssignments, []), safe(getMyPublishedVideoTasks, [])])
    : [[], []];
  const rawChild = Array.isArray(query.child) ? query.child[0] : query.child;
  const selectedChild = myStudents.some((student) => student.id === rawChild) ? rawChild : null;
  const visibleAssignments = selectedChild ? assignments.filter((assignment) => assignment.studentId === selectedChild) : assignments;
  const visibleVideoTasks = selectedChild ? videoTasks.filter((task) => task.studentId === selectedChild) : videoTasks;
  const rawVideoSession = Array.isArray(query.videoSession) ? query.videoSession[0] : query.videoSession;
  const rawVideoStudent = Array.isArray(query.videoStudent) ? query.videoStudent[0] : query.videoStudent;

  return (
    <DashboardPage title={t("learningActionsTitle")} description={t("learningActionsIntro")}>
      <DashboardContentGrid>
        <DashboardMainColumn className="space-y-6">
          {!isBound ? (
            <DashboardCard>
              <p className="text-sm text-muted">{t("notBound")}</p>
              <div className="mt-4"><BindCodeForm mode="claim" /></div>
            </DashboardCard>
          ) : (
            <>
              {myStudents.length > 1 && (
                <nav aria-label={t("chooseChild")} className="flex flex-wrap gap-2">
                  <Link href="/dashboard/assignments" className={cn(buttonVariants({ size: "sm", variant: selectedChild ? "secondary" : "primary" }))}>{t("allChildren")}</Link>
                  {myStudents.map((student) => (
                    <Link key={student.id} href={`/dashboard/assignments?child=${student.id}`} className={cn(buttonVariants({ size: "sm", variant: selectedChild === student.id ? "primary" : "secondary" }))}>{student.name}</Link>
                  ))}
                </nav>
              )}
              <DashboardCard title={t("pendingAssignmentsTitle")}>
                {visibleAssignments.length === 0 ? (
                  <DashboardEmptyCard>{t("pendingAssignmentsEmpty")}</DashboardEmptyCard>
                ) : (
                  <ul className="divide-y divide-line">
                    {visibleAssignments.map((assignment) => (
                      <li key={`${assignment.assignmentId}:${assignment.studentId}`} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                        <span className="min-w-0 flex-1 truncate font-medium">{assignment.title}</span>
                        {myStudents.length > 1 && <span className="shrink-0 text-xs text-muted">{assignment.studentName}</span>}
                        <span className="shrink-0 text-xs text-muted">{assignment.classroomName}</span>
                        {assignment.dueAt && <time className="shrink-0 text-xs text-rose">{new Intl.DateTimeFormat(locale, { dateStyle: "short" }).format(new Date(assignment.dueAt))}</time>}
                        <Link href={`/dashboard/assignments/${assignment.assignmentId}?student=${assignment.studentId}`} className="shrink-0 text-xs text-crater underline underline-offset-2">{t("goSubmit")}</Link>
                      </li>
                    ))}
                  </ul>
                )}
              </DashboardCard>
              <DashboardCard title={t("videoTasksTitle")}>
                <div id="video-tasks" className="scroll-mt-24">
                  {visibleVideoTasks.length === 0 ? (
                    <DashboardEmptyCard>{t("videoTasksEmpty")}</DashboardEmptyCard>
                  ) : (
                    <ul className="divide-y divide-line">
                      {visibleVideoTasks.map((task) => (
                        <li key={task.videoTaskId + ":" + task.studentId} className="py-3 text-sm">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
                            {myStudents.length > 1 && <span className="text-xs text-muted">{task.studentName}</span>}
                            <span className="text-xs text-muted">{task.classroomName} · {task.lectureName}</span>
                            <span className="text-xs text-muted">{task.submitted ? t("videoTaskSubmitted") : t("videoTaskPending")}</span>
                            {!task.submitted && (
                              <Link
                                href={"/dashboard/assignments?videoSession=" + task.sessionId + "&videoStudent=" + task.studentId + "#video-upload"}
                                className="text-xs text-crater underline underline-offset-2"
                              >
                                {t("goUploadVideo")}
                              </Link>
                            )}
                          </div>
                          {task.instructions && <p className="mt-2 whitespace-pre-wrap text-xs text-muted">{task.instructions}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </DashboardCard>
              <div id="video-upload" className="scroll-mt-24">
                <ManagedVideoUploadPanel initialSessionId={rawVideoSession} initialStudentId={rawVideoStudent} />
              </div>
            </>
          )}
        </DashboardMainColumn>
      </DashboardContentGrid>
    </DashboardPage>
  );
}
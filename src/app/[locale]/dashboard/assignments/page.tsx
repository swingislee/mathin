import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { BindCodeForm } from "@/features/school/BindCodeForm";
import {
  getMyPendingAssignments,
  getMyPublishedVideoTasks,
  getMyStudents,
} from "@/features/school/customer";
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
  const rawVideoTask = Array.isArray(query.videoTask) ? query.videoTask[0] : query.videoTask;
  const rawVideoStudent = Array.isArray(query.videoStudent) ? query.videoStudent[0] : query.videoStudent;
  const selectedVideoTask = visibleVideoTasks.find((task) =>
    !task.submitted && task.videoTaskId === rawVideoTask && task.studentId === rawVideoStudent
  ) ?? null;

  return (
    <DashboardPage title={t("learningActionsTitle")} description={t("learningActionsIntro")}>
      <DashboardContentGrid>
        <DashboardMainColumn className="space-y-6 @4xl/page:col-span-12">
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
                    <DashboardEmptyCard className="min-h-20 p-4">{t("videoTasksEmpty")}</DashboardEmptyCard>
                  ) : (
                    <ul className="divide-y divide-line">
                      {visibleVideoTasks.map((task) => {
                        const uploadOpen = selectedVideoTask?.videoTaskId === task.videoTaskId
                          && selectedVideoTask.studentId === task.studentId;
                        const taskAnchor = `video-task-${task.videoTaskId}-${task.studentId}`;
                        const uploadHref = `/dashboard/assignments?videoTask=${task.videoTaskId}&videoStudent=${task.studentId}${selectedChild ? `&child=${selectedChild}` : ""}#${taskAnchor}`;
                        return (
                          <li id={taskAnchor} key={task.videoTaskId + ":" + task.studentId} className="scroll-mt-24 py-3 text-sm">
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
                              {myStudents.length > 1 && <span className="text-xs text-muted">{task.studentName}</span>}
                              <span className="text-xs text-muted">{task.classroomName} · {task.lectureName}</span>
                              <span className="text-xs text-muted">{task.submitted ? t("videoTaskSubmitted") : t("videoTaskPending")}</span>
                              {!task.submitted && !uploadOpen && <Link href={uploadHref} className="text-xs text-crater underline underline-offset-2">{t("goUploadVideo")}</Link>}
                            </div>
                            {task.instructions && <p className="mt-2 whitespace-pre-wrap text-xs text-muted">{task.instructions}</p>}
                            {uploadOpen && (
                              <ManagedVideoUploadPanel task={{
                                videoTaskId: task.videoTaskId,
                                sessionId: task.sessionId,
                                studentId: task.studentId,
                                classroomId: task.classroomId,
                                classroomName: task.classroomName,
                                lectureName: task.lectureName,
                              }} />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </DashboardCard>
            </>
          )}
        </DashboardMainColumn>
      </DashboardContentGrid>
    </DashboardPage>
  );
}
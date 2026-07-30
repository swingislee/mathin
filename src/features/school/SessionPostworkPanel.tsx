import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSessionReport } from "@/features/classroom/actions";
import { AttendanceDrawer } from "./AttendanceDrawer";
import type { SessionWorkspaceDetail } from "./classes";
import { ReviewDrawer } from "./ReviewDrawer";
import { SessionAssignmentPublisher } from "./SessionAssignmentPublisher";
import { SessionCompletePostworkButton } from "./SessionCompletePostworkButton";
import { SessionFamilyBriefPanel } from "./SessionFamilyBriefPanel";
import { SessionFollowUpQuickForm } from "./SessionFollowUpQuickForm";
import { SessionTaskActions } from "./SessionPostworkActions";
import { SessionVideoTaskPublisher } from "./SessionVideoTaskPublisher";
import { SupportTaskRecipientList } from "./SupportTaskRecipientList";
import { VideoReviewPanel } from "./VideoReviewPanel";
import { listSessionVideos } from "./videos";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

async function currentProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? getProfile(user.id) : null;
}

const TASK_KIND_KEYS = {
  attendance: "taskKind_attendance",
  reviews: "taskKind_reviews",
  summary: "taskKind_summary",
  assignment: "taskKind_assignment",
  video_review: "taskKind_videoReview",
  followup: "taskKind_followup",
} as const;

export async function SessionPostworkPanel({ detail }: { detail: SessionWorkspaceDetail }) {
  const t = await getTranslations("school.session");
  const tc = await getTranslations("school.classes");
  const reportT = await getTranslations("classroom.report");

  const pendingRequired = detail.completionTasks.filter((task) => task.required && task.status === "pending").length;
  const followupTask = detail.completionTasks.find((task) => task.kind === "followup");
  const hasVideoReviewTask = detail.completionTasks.some((task) => task.kind === "video_review");
  const [sessionVideos, report] = await Promise.all([
    hasVideoReviewTask && detail.capabilities.canReviewVideo ? listSessionVideos(detail.id) : Promise.resolve([]),
    getSessionReport(detail.id).catch(() => ({ rows: [], quizzes: [], learningChecks: [] })),
  ]);
  const isAdmin = sessionVideos.length > 0 && (await currentProfile())?.role === "admin";

  return (
    <div className="flex flex-col gap-5 px-1">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card p-4 text-sm">
        <div>
          <p className="text-ink">{detail.postworkCompletedAt ? t("postworkAllDone") : t("postworkPending", { count: pendingRequired })}</p>
          <p className="mt-1 text-xs text-muted">{t("postworkWorkspaceHint")}</p>
        </div>
        <div className="flex items-center gap-3">
          {detail.capabilities.canMarkAttendance && <AttendanceDrawer sessionId={detail.id} mode="amend" />}
          <SessionCompletePostworkButton
            sessionId={detail.id}
            completed={Boolean(detail.postworkCompletedAt)}
            disabled={!detail.capabilities.canCompletePostwork}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-medium text-ink">{t("classPerformanceTitle")}</h3>
            <p className="mt-1 text-xs text-muted">{t("classPerformanceHint")}</p>
          </div>
          {detail.capabilities.canWriteReview && <ReviewDrawer sessionId={detail.id} />}
        </div>
        {report.rows.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{reportT("noStudents")}</p>
        ) : (
          <div className="mt-4">
            <Table className="text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead>{reportT("student")}</TableHead>
                  <TableHead>{reportT("attendance")}</TableHead>
                  <TableHead>{reportT("stars")}</TableHead>
                  {report.learningChecks.map((check, index) => (
                    <TableHead key={check.id}>{index + 1}. {check.title}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((row) => (
                  <TableRow key={row.userId}>
                    <TableCell>{row.displayName || "—"}</TableCell>
                    <TableCell>{row.attendanceStatus ? reportT("attendance_" + row.attendanceStatus) : reportT("notCaptured")}</TableCell>
                    <TableCell>{row.stars}</TableCell>
                    {report.learningChecks.map((check) => {
                      const status = check.results.find((result) => result.studentId === row.studentId)?.status ?? "unchecked";
                      return <TableCell key={check.id}>{t("learningStatus_" + status)}</TableCell>;
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-3 font-medium text-ink">{t("independentPublicationsTitle")}</h3>
        <p className="-mt-2 mb-3 text-xs text-muted">{t("independentPublicationsHint")}</p>
        <div className="grid gap-4 xl:grid-cols-3">
          <SessionFamilyBriefPanel detail={detail} />
          {detail.capabilities.canWriteReview && (
            <>
              <SessionAssignmentPublisher sessionId={detail.id} assignments={detail.publishedAssignments} />
              <SessionVideoTaskPublisher sessionId={detail.id} task={detail.videoTask} />
            </>
          )}
        </div>
      </section>

      <ol className="divide-y divide-line rounded-2xl border border-line">
        {detail.completionTasks
          .filter((task) => task.kind !== "attendance" || task.status === "pending")
          .map((task) => (
            <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="text-ink">{t(TASK_KIND_KEYS[task.kind])}</span>
                {task.required && <Badge variant="outline">{t("taskRequired")}</Badge>}
                <Badge variant={task.status === "done" ? "default" : task.status === "skipped" ? "outline" : "secondary"}>
                  {task.status === "done" ? t("taskDone") : task.status === "skipped" ? t("taskSkipped") : t("taskPending")}
                </Badge>
                {task.assignedToName && <span className="text-xs text-muted">{t("taskAssignedTo", { name: task.assignedToName })}</span>}
              </div>
              {task.status === "pending" ? (
                <div className="flex shrink-0 items-center gap-2">
                  {task.kind === "attendance" && detail.capabilities.canMarkAttendance && <AttendanceDrawer sessionId={detail.id} />}
                  {task.kind === "reviews" && detail.capabilities.canWriteReview && <ReviewDrawer sessionId={detail.id} />}
                  <SessionTaskActions taskId={task.id} disabled={false} hideMarkDone={task.kind !== "video_review"} />
                </div>
              ) : (
                <span className="shrink-0 text-xs text-muted">
                  {task.completedByName ? t("taskCompletedBy", { name: task.completedByName }) : tc("notApplicable")}
                </span>
              )}
            </li>
          ))}
      </ol>

      {followupTask && followupTask.status === "pending" && (
        <SessionFollowUpQuickForm taskId={followupTask.id} roster={detail.roster} />
      )}

      {hasVideoReviewTask && detail.capabilities.canReviewVideo && (
        <section className="rounded-2xl border border-line bg-card p-4 text-sm">
          <h3 className="mb-2 text-xs font-medium uppercase text-muted">{t("taskKind_videoReview")}</h3>
          {sessionVideos.length === 0 ? (
            <p className="text-muted">{t("videoReviewEmpty")}</p>
          ) : (
            <VideoReviewPanel rows={sessionVideos} canDelete={isAdmin} />
          )}
        </section>
      )}

      {detail.supportTasks.length > 0 && (
        <section className="rounded-2xl border border-line bg-card p-4 text-sm">
          <h3 className="mb-2 text-xs font-medium uppercase text-muted">{t("supportTasksTitle")}</h3>
          <ul className="flex flex-col gap-3">
            {detail.supportTasks.map((task) => (
              <li key={task.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-ink">{tc("supportTaskKind_" + task.kind)}</span>
                    {task.studentName && <span className="text-xs text-muted">{task.studentName}</span>}
                    <Badge variant={task.status === "done" ? "default" : task.status === "pending" ? "secondary" : "outline"}>
                      {tc("supportTaskStatus_" + task.status)}
                    </Badge>
                  </div>
                </div>
                {task.recipients.length > 0 && <SupportTaskRecipientList recipients={task.recipients} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

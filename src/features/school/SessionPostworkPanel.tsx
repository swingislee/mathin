import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { getSessionReport, listSubmissions } from "@/features/classroom/actions";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { SessionWorkspaceDetail } from "./classes";
import { getReviewDrawerData } from "./review-actions";
import { SessionAssignmentPublisher } from "./SessionAssignmentPublisher";
import { SessionAssignmentReviewPanel, type SessionAssignmentReviewItem } from "./SessionAssignmentReviewPanel";
import { SessionFamilyBriefPanel } from "./SessionFamilyBriefPanel";
import { SessionTaskActions } from "./SessionPostworkActions";
import { SessionStudentPostworkCards, type SessionStudentPostworkRow } from "./SessionStudentPostworkCards";
import { SessionVideoTaskPublisher } from "./SessionVideoTaskPublisher";
import { SupportTaskRecipientList } from "./SupportTaskRecipientList";
import { TeachingPostworkSection, TeachingPostworkStatus } from "./TeachingPostworkSurface";
import { VideoReviewPanel } from "./VideoReviewPanel";
import { listSessionVideos } from "./videos";

async function currentProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? getProfile(user.id) : null;
}

export async function SessionPostworkPanel({ detail }: { detail: SessionWorkspaceDetail }) {
  const t = await getTranslations("school.session");
  const tc = await getTranslations("school.classes");
  const pendingRequired = detail.completionTasks.filter((task) => task.required && task.status === "pending").length;
  const requiredTotal = detail.completionTasks.filter((task) => task.required).length;
  const completedRequired = requiredTotal - pendingRequired;
  const followupTask = detail.completionTasks.find((task) => task.kind === "followup") ?? null;
  const videoReviewTask = detail.completionTasks.find((task) => task.kind === "video_review") ?? null;

  const [sessionVideos, report, reviewData, assignmentReviewItems] = await Promise.all([
    videoReviewTask && detail.capabilities.canReviewVideo ? listSessionVideos(detail.id) : Promise.resolve([]),
    getSessionReport(detail.id).catch(() => ({ rows: [], quizzes: [], learningChecks: [] })),
    detail.capabilities.canWriteReview
      ? getReviewDrawerData(detail.id).catch(() => ({
          records: detail.roster.map((student) => ({
            studentId: student.studentId,
            studentName: student.studentName,
            entryScore: null,
            exitScore: null,
            focus: null,
            participation: null,
            mastery: null,
            comment: "",
          })),
        }))
      : Promise.resolve({ records: [] }),
    detail.capabilities.canWriteReview
      ? Promise.all(detail.publishedAssignments.map(async (assignment): Promise<SessionAssignmentReviewItem> => ({
          assignment,
          submissions: await listSubmissions(assignment.id).catch(() => []),
        })))
      : Promise.resolve([]),
  ]);
  const isAdmin = sessionVideos.length > 0 && (await currentProfile())?.role === "admin";
  const reviewResults = detail.learningResults.filter((result) => result.kind === "session_review");
  const reviewStatuses = new Set(reviewResults.map((result) => result.status));
  const reviewResultStatus = reviewStatuses.size === 1
    ? reviewResults[0].status
    : reviewStatuses.has("revised")
      ? "revised"
      : reviewStatuses.has("withdrawn")
        ? "withdrawn"
        : reviewStatuses.has("published")
          ? "published"
          : "draft";
  const reportByStudent = new Map(report.rows.map((row) => [row.studentId, row] as const));
  const studentRows: SessionStudentPostworkRow[] = detail.roster.map((student) => {
    const reportRow = reportByStudent.get(student.studentId);
    return {
      studentId: student.studentId,
      displayName: student.studentName,
      attendanceStatus: reportRow?.attendanceStatus ?? null,
      stars: reportRow?.stars ?? 0,
      checks: report.learningChecks.map((check) => ({
        id: check.id,
        title: check.title,
        status: check.results.find((result) => result.studentId === student.studentId)?.status ?? "unchecked",
      })),
    };
  });

  return (
    <div className="flex flex-col gap-5 px-1">
      <TeachingPostworkStatus
        complete={pendingRequired === 0}
        label={detail.postworkCompletedAt ? t("postworkAllDone") : t("postworkPending", { count: pendingRequired })}
        done={completedRequired}
        total={requiredTotal}
        progressLabel={t("completionProgress", { done: completedRequired, total: requiredTotal })}
      />

      <section>
        <h3 className="mb-3 font-medium text-ink">{t("independentPublicationsTitle")}</h3>
        <p className="-mt-2 mb-3 text-xs text-muted">{t("independentPublicationsHint")}</p>
        <div className="grid gap-4 @4xl/page:grid-cols-3">
          <SessionFamilyBriefPanel detail={detail} />
          {detail.capabilities.canWriteReview && (
            <>
              <SessionAssignmentPublisher sessionId={detail.id} assignments={detail.publishedAssignments} />
              <SessionVideoTaskPublisher sessionId={detail.id} task={detail.videoTask} />
            </>
          )}
        </div>
      </section>

      <TeachingPostworkSection title={t("classPerformanceTitle")} description={t("classPerformanceHint")}>
        <SessionStudentPostworkCards
          sessionId={detail.id}
          rows={studentRows}
          initialReviews={reviewData.records}
          resultStatus={reviewResultStatus}
          canWriteReview={detail.capabilities.canWriteReview}
          followupTask={followupTask ? { id: followupTask.id, status: followupTask.status } : null}
        />
      </TeachingPostworkSection>

      {detail.capabilities.canWriteReview && <SessionAssignmentReviewPanel items={assignmentReviewItems} />}

      {videoReviewTask && detail.capabilities.canReviewVideo && (
        <section className="rounded-2xl border border-line bg-card p-4 text-sm">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-medium text-ink">{t("taskKind_videoReview")}</h3>
              <p className="mt-1 text-xs text-muted">{t("videoReviewPanelHint")}</p>
            </div>
            {videoReviewTask.status === "pending" && (
              <SessionTaskActions taskId={videoReviewTask.id} disabled={false} />
            )}
          </div>
          {sessionVideos.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-3 py-5 text-center text-muted">{t("videoReviewEmpty")}</p>
          ) : (
            <VideoReviewPanel rows={sessionVideos} canDelete={isAdmin} />
          )}
        </section>
      )}

      {detail.supportTasks.length > 0 && (
        <section className="rounded-2xl border border-line bg-card p-4 text-sm">
          <h3 className="mb-2 text-xs font-medium uppercase text-muted">{t("supportTasksTitle")}</h3>
          <ul className="grid gap-3 @3xl/page:grid-cols-2">
            {detail.supportTasks.map((task) => (
              <li key={task.id} className="rounded-xl border border-line p-3">
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

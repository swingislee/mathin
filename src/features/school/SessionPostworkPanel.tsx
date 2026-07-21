import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { AttendanceDrawer } from "./AttendanceDrawer";
import type { SessionWorkspaceDetail } from "./classes";
import { ReviewDrawer } from "./ReviewDrawer";
import { SessionCompletePostworkButton } from "./SessionCompletePostworkButton";
import { SessionFamilyBriefPanel } from "./SessionFamilyBriefPanel";
import { SessionFollowUpQuickForm } from "./SessionFollowUpQuickForm";
import { SessionTaskActions } from "./SessionPostworkActions";
import { SupportTaskRecipientList } from "./SupportTaskRecipientList";
import { VideoReviewPanel } from "./VideoReviewPanel";
import { listSessionVideos } from "./videos";

const TASK_KIND_KEYS = {
  attendance: "taskKind_attendance",
  reviews: "taskKind_reviews",
  summary: "taskKind_summary",
  assignment: "taskKind_assignment",
  video_review: "taskKind_videoReview",
  followup: "taskKind_followup",
} as const;

/**
 * 课后（doc19 §14.9）：点名/课评+总结/视频审阅/跟进已接上各自的专用表单（AttendanceDrawer/
 * ReviewDrawer/VideoReviewPanel/SessionFollowUpQuickForm，均为 P4B/P4D 时期已有的完整实现，
 * 保存成功后顺带把对应任务标记完成）；作业没有内容表规格，维持通用标记完成/跳过。
 */
export async function SessionPostworkPanel({ detail }: { detail: SessionWorkspaceDetail }) {
  const t = await getTranslations("school.session");
  const tc = await getTranslations("school.classes");

  const pendingRequired = detail.completionTasks.filter((task) => task.required && task.status === "pending").length;
  const followupTask = detail.completionTasks.find((task) => task.kind === "followup");
  const hasVideoTask = detail.completionTasks.some((task) => task.kind === "video_review");
  const sessionVideos = hasVideoTask && detail.capabilities.canReviewVideo ? await listSessionVideos(detail.id) : [];

  return (
    <div className="flex flex-col gap-4 px-1">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card p-4 text-sm">
        <div>
          <p className="text-ink">{detail.postworkCompletedAt ? t("postworkAllDone") : t("postworkPending", { count: pendingRequired })}</p>
          {detail.familyBrief.publishedAt && <p className="text-xs text-muted">{t("familyBriefPublished")}</p>}
        </div>
        <SessionCompletePostworkButton
          sessionId={detail.id}
          completed={Boolean(detail.postworkCompletedAt)}
          disabled={!detail.capabilities.canCompletePostwork}
        />
      </section>

      <ol className="divide-y divide-line rounded-2xl border border-line">
        {detail.completionTasks.map((task) => (
          <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="text-ink">{t(TASK_KIND_KEYS[task.kind])}</span>
              {task.required && <Badge variant="outline">{t("taskRequired")}</Badge>}
              <Badge variant={task.status === "done" ? "default" : task.status === "skipped" ? "outline" : "secondary"}>
                {task.status === "done" ? t("taskDone") : task.status === "skipped" ? t("taskSkipped") : t("taskPending")}
              </Badge>
              {task.assignedToName && <span className="text-xs text-muted">{t("taskAssignedTo", { name: task.assignedToName })}</span>}
              {task.dueAt && <span className="text-xs text-muted">{new Date(task.dueAt).toLocaleString()}</span>}
            </div>
            {task.status === "pending" ? (
              <div className="flex shrink-0 items-center gap-2">
                {task.kind === "attendance" && detail.capabilities.canMarkAttendance && <AttendanceDrawer sessionId={detail.id} />}
                {(task.kind === "reviews" || task.kind === "summary") && detail.capabilities.canWriteReview && <ReviewDrawer sessionId={detail.id} />}
                <SessionTaskActions taskId={task.id} disabled={false} hideMarkDone={task.kind !== "assignment" && task.kind !== "video_review"} />
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

      {hasVideoTask && detail.capabilities.canReviewVideo && (
        <section className="rounded-2xl border border-line bg-card p-4 text-sm">
          <h3 className="mb-2 text-xs font-medium uppercase text-muted">{t("taskKind_videoReview")}</h3>
          {sessionVideos.length === 0 ? (
            <p className="text-muted">{t("videoReviewEmpty")}</p>
          ) : (
            <VideoReviewPanel rows={sessionVideos} />
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
                    <span className="text-ink">{tc(`supportTaskKind_${task.kind}`)}</span>
                    {task.studentName && <span className="text-xs text-muted">{task.studentName}</span>}
                    <Badge variant={task.status === "done" ? "default" : task.status === "pending" ? "secondary" : "outline"}>
                      {tc(`supportTaskStatus_${task.status}`)}
                    </Badge>
                    {task.assignedToName && <span className="text-xs text-muted">{t("taskAssignedTo", { name: task.assignedToName })}</span>}
                  </div>
                </div>
                {task.recipients.length > 0 && <SupportTaskRecipientList recipients={task.recipients} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      <SessionFamilyBriefPanel detail={detail} />
    </div>
  );
}

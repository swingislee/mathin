import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import type { SessionWorkspaceDetail } from "./classes";
import { SessionCompletePostworkButton } from "./SessionCompletePostworkButton";
import { SessionTaskActions } from "./SessionPostworkActions";

const TASK_KIND_KEYS = {
  attendance: "taskKind_attendance",
  reviews: "taskKind_reviews",
  summary: "taskKind_summary",
  assignment: "taskKind_assignment",
  video_review: "taskKind_videoReview",
  followup: "taskKind_followup",
} as const;

/**
 * 课后（doc19 §14.9）：本任务只做通用"标记完成/跳过"清单 + 完成本次课整体门控；
 * 各任务类型的专用表单（点名网格/课评撰写/视频审阅等）留给 P4I-15。
 */
export async function SessionPostworkPanel({ detail }: { detail: SessionWorkspaceDetail }) {
  const t = await getTranslations("school.session");
  const tc = await getTranslations("school.classes");

  const pendingRequired = detail.completionTasks.filter((task) => task.required && task.status === "pending").length;

  return (
    <div className="flex flex-col gap-4 px-1">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card p-4 text-sm">
        <div>
          <p className="text-ink">{detail.postworkCompletedAt ? t("postworkAllDone") : t("postworkPending", { count: pendingRequired })}</p>
          {detail.familyBriefPublishedAt && <p className="text-xs text-muted">{t("familyBriefPublished")}</p>}
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
              <SessionTaskActions taskId={task.id} disabled={false} />
            ) : (
              <span className="shrink-0 text-xs text-muted">
                {task.completedByName ? t("taskCompletedBy", { name: task.completedByName }) : tc("notApplicable")}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

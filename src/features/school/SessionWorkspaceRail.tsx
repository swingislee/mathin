import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import type { SessionWorkspaceDetail } from "./classes";

/**
 * 课次决策栏内容（doc 23 §10）：课次摘要 / 完成状态 / 下一步。
 *
 * 原来课次工作区右边什么都没有——三个阶段面板轮流独占整宽，于是"这节课是哪个班、
 * 几点、多久、还差什么"只能靠切回课前面板去翻。这些恰恰是做课后工作时要一直看得见的
 * 上下文，属于 Rail 而不是某一个阶段。
 *
 * 只读：所有操作仍在各阶段面板里，Rail 不重复提供第二套按钮。
 */
export async function SessionWorkspaceRail({
  detail,
  stageHref,
}: {
  detail: SessionWorkspaceDetail;
  /** 生成 `?stage=` 链接，供"下一步"指向具体阶段。 */
  stageHref: (stage: "pre" | "live" | "post") => string;
}) {
  const t = await getTranslations("school.session");
  const tc = await getTranslations("school.classes");

  const tasks = detail.completionTasks;
  const done = tasks.filter((task) => task.status !== "pending").length;

  const nextStep = resolveNextStep(detail);

  return (
    <>
      <section>
        <h3 className="text-xs uppercase tracking-[0.14em] text-muted">{t("summaryTitle")}</h3>
        <dl className="mt-2 flex flex-col gap-1.5 text-sm">
          <Row label={tc("title")} value={<Link href={`/dashboard/classes/${detail.classroomId}`} className="text-ink hover:text-crater">{detail.classroomName}</Link>} />
          <Row label={t("scheduledAt")} value={detail.scheduledAt ? new Date(detail.scheduledAt).toLocaleString() : "—"} />
          <Row label={t("durationLabel")} value={detail.durationMin ? t("durationMin", { count: detail.durationMin }) : "—"} />
          <Row label={t("primaryTeacher")} value={detail.primaryTeacherName ?? "—"} />
          {detail.teacherOverrideName ? <Row label={tc("substitute")} value={detail.teacherOverrideName} /> : null}
          <Row label={t("rosterCount")} value={String(detail.rosterCount)} />
        </dl>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-[0.14em] text-muted">{t("completionTitle")}</h3>
        {tasks.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t("completionEmpty")}</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-ink">{t("completionProgress", { done, total: tasks.length })}</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {tasks.map((task) => (
                <li key={task.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-muted">{t(COMPLETION_TASK_KEY[task.kind])}</span>
                  <Badge variant={task.status === "done" ? "secondary" : task.status === "skipped" ? "outline" : "danger"}>
                    {t(task.status === "done" ? "taskDone" : task.status === "skipped" ? "taskSkipped" : "taskPending")}
                  </Badge>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-[0.14em] text-muted">{t("nextStepTitle")}</h3>
        {nextStep ? (
          <Link href={stageHref(nextStep.stage)} className="mt-2 block text-sm text-crater hover:underline">
            {t(nextStep.labelKey)}
          </Link>
        ) : (
          <p className="mt-2 text-sm text-muted">{t("nextStepNone")}</p>
        )}
      </section>
    </>
  );
}

const COMPLETION_TASK_KEY: Record<SessionWorkspaceDetail["completionTasks"][number]["kind"], string> = {
  attendance: "taskKind_attendance",
  reviews: "taskKind_reviews",
  summary: "taskKind_summary",
  assignment: "taskKind_assignment",
  video_review: "taskKind_videoReview",
  followup: "taskKind_followup",
};

/** 与 ObjectBar 主动作同源的下一步判断，只是这里指向阶段而不是教室。 */
function resolveNextStep(detail: SessionWorkspaceDetail): { stage: "pre" | "live" | "post"; labelKey: string } | null {
  if (detail.state === "scheduled" && detail.prepStatus !== "ready") {
    return { stage: "pre", labelKey: detail.prepStatus === "not_started" ? "startPrep" : "completePrep" };
  }
  if (detail.state === "ended" && !detail.postworkCompletedAt) return { stage: "post", labelKey: "handlePostwork" };
  return null;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-xs text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-ink">{value}</dd>
    </div>
  );
}

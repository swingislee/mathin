import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import type { SessionWorkspaceDetail } from "./classes";
import { getLectureCoursewareTemplate } from "./courses";
import { CoursewareOverlayEditor } from "./CoursewareOverlayEditor";
import { LeaveRequestActions } from "./LeaveRequestActions";
import { SessionPrepActions } from "./SessionPrepActions";
import { SessionTrackOverrideSelect } from "./SessionTrackOverrideSelect";

/** 课前（doc19 §14.3）：时间地点/主讲代课/学生名单/请假/讲次目标/权威课件/本次轨道/本次覆盖/备课动作。 */
export async function SessionPrepPanel({ detail }: { detail: SessionWorkspaceDetail }) {
  const t = await getTranslations("school.session");
  const tc = await getTranslations("school.classes");

  const template = detail.lectureId ? await getLectureCoursewareTemplate(detail.lectureId) : [];
  const canEditOverlay = detail.capabilities.canPrepare && !detail.coursewareFrozenAt && detail.lectureId;
  const canRunPrepActions = detail.capabilities.canPrepare && detail.state === "scheduled" && detail.lectureId;

  const prepStatusLabel = detail.prepStatus === "ready" ? t("prepStatusReady")
    : detail.prepStatus === "in_progress" ? t("prepStatusInProgress")
    : t("prepStatusNotStarted");

  // 摘要搬去 Rail 之后，课前这一段在"已下课且无讲次"这类情形下可能什么都不剩。
  // panel 的主区不允许出现空白（§22）——右边 Rail 满满一栏、左边一片空白最难判断
  // 到底是没数据还是没加载出来。
  const hasContent = Boolean(detail.lectureObjectives) || detail.pendingLeaveRequests.length > 0 || Boolean(detail.lectureId);

  return (
    <div className="flex flex-col gap-4 px-1">
      {!hasContent && <p className="rounded-2xl border border-line bg-card p-4 text-sm text-muted">{t("stageEmpty")}</p>}
      {/*
        doc23 §10：时间 / 主讲 / 代课 / 人数原来在这里再说一遍，现在归 WorkspaceRail
        的课次摘要——它们是做课前工作时要一直看得见的上下文，不该只在"课前"这一段出现，
        更不该在同一屏出现两次（§15 禁止新旧并存）。这里只留讲次目标：它属于备课本身。
        顺带修掉 <dt>/<dd> 直接挂在 <section> 上的无效嵌套。
      */}
      {detail.lectureObjectives && (
        <dl className="rounded-2xl border border-line bg-card p-4 text-sm">
          <dt className="text-xs text-muted">{t("lectureObjectives")}</dt>
          <dd className="mt-1.5 leading-6 text-ink">{detail.lectureObjectives}</dd>
        </dl>
      )}

      {detail.pendingLeaveRequests.length > 0 && (
        <section className="rounded-2xl border border-line bg-card p-4 text-sm">
          <h3 className="mb-2 text-xs font-medium uppercase text-muted">{t("pendingLeaveRequests")}</h3>
          <ul className="flex flex-col gap-1.5">
            {detail.pendingLeaveRequests.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-ink">{row.studentName}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{row.reason || t("noReason")}</span>
                {detail.capabilities.canMarkAttendance && <LeaveRequestActions requestId={row.id} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {detail.lectureId && (
        <section className="grid gap-3 rounded-2xl border border-line bg-card p-4 text-sm sm:grid-cols-2">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">{t("authorityRelease")}</dt>
            <dd className="text-ink">
              {detail.currentReleaseNo ? `v${detail.currentReleaseNo}` : t("noRelease")}
              {detail.hasUnpublishedChanges && <Badge variant="outline" className="ml-2">{t("updateAvailable")}</Badge>}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">{t("trackOverride")}</dt>
            <dd>
              {detail.capabilities.canPrepare && detail.state === "scheduled" ? (
                <SessionTrackOverrideSelect sessionId={detail.id} override={detail.coursewareTrackOverride} />
              ) : (
                <Badge variant="outline">{detail.coursewareTrack === "adapted-4x3" ? tc("coursewareTrackAdaptedShort") : tc("coursewareTrackNativeShort")}</Badge>
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3 sm:col-span-2">
            <dt className="text-muted">{t("prepStatus")}</dt>
            <dd className="flex items-center gap-2">
              <Badge variant="secondary">{prepStatusLabel}</Badge>
              {detail.prepAutoFrozen && <Badge variant="outline">{t("prepAutoFrozen")}</Badge>}
              {detail.prepPreparedAt && <span className="text-xs text-muted">{new Date(detail.prepPreparedAt).toLocaleString()}</span>}
            </dd>
          </div>
        </section>
      )}

      {canRunPrepActions && (
        <SessionPrepActions
          sessionId={detail.id}
          prepStatus={detail.prepStatus}
          hasRelease={detail.currentReleaseNo !== null}
          hasUnpublishedChanges={detail.hasUnpublishedChanges}
        />
      )}

      {canEditOverlay ? (
        <CoursewareOverlayEditor
          classroomId={detail.classroomId}
          sessionId={detail.id}
          template={template}
          initialOverlay={detail.coursewareOverlay}
        />
      ) : detail.coursewareFrozenAt ? (
        <p className="text-sm text-muted">{t("overlayFrozen")}</p>
      ) : null}
    </div>
  );
}

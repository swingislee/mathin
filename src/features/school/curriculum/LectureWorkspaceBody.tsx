import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import type { CoursewareLecturePreview, CoursewareTrack } from "@/features/courseware-studio/data";
import {
  ObjectBar,
  ObjectWorkspace,
  TrackSwitcher,
  WorkspaceMain,
  WorkspaceRail,
  WorkspaceSplitShell,
} from "@/features/school/object-workspace";
import { StatusStrip } from "@/features/school/dashboard-page";
import type { StaffOption } from "@/features/school/classes";
import { ResponsibilityPanel } from "@/features/school/teaching-operations/ResponsibilityPanel";
import { Link } from "@/i18n/navigation";
import { LectureCoursewarePreview } from "./LectureCoursewarePreview";
import type { LectureWorkspaceDetail } from "./types";
import { lectureStageLabelKey } from "./stage-label";

// doc24 §6：换轨与翻页都是**对象内部**导航，来源必须原样传下去。
// 少了这一层，从适配校对队列点进讲次、翻一页、再点返回，就会退到课程版本页。
function trackHref(baseHref: string, track: CoursewareTrack, returnTo: string | null) {
  const search = new URLSearchParams({ track });
  if (returnTo) search.set("returnTo", returnTo);
  return `${baseHref}?${search.toString()}`;
}

function pageHref(baseHref: string, track: CoursewareTrack, page: number, returnTo: string | null) {
  const search = new URLSearchParams({ track });
  if (page > 1) search.set("page", String(page));
  if (returnTo) search.set("returnTo", returnTo);
  return `${baseHref}?${search.toString()}`;
}

/**
 * 讲次工作区（doc 23 §12）。
 *
 * 重建前：`LectureWorkspaceShell`（讲次专用、结构其实完全通用）把正文与决策栏并排，
 * 正文内部再纵向堆四张卡——教学目标、权威预览、责任分配、使用情况。于是这一页真正的
 * 主角（课件预览）只分到主区的一小段，而"谁负责"和"哪些班在用"这两块参考信息占着
 * 主工作区的宽度，还要滚动才能翻到。
 *
 * 现在主区只剩"目标摘要 + 权威预览"，预览是视觉重点；责任与使用挪进通用
 * WorkspaceRail，和流程决策放在一起——它们都是"看着预览做判断时要参考的东西"。
 * 专用 Shell 删除，改用 WorkspaceSplitShell。
 */
export async function LectureWorkspaceBody({
  detail,
  track,
  baseHref,
  backHref,
  returnTo,
  canOpenCoursewareWorkbench,
  canAssign,
  staffOptions,
  preview,
  decisionContent,
}: {
  detail: LectureWorkspaceDetail;
  track: CoursewareTrack;
  baseHref: string;
  /** 已过 resolveReturnTarget 校验的来源地址（默认课程版本）。 */
  backHref: string;
  /** 已校验的 `?returnTo=`，没有来源时为 null；对象内部链接据此决定要不要带上。 */
  returnTo: string | null;
  canOpenCoursewareWorkbench: boolean;
  canAssign: boolean;
  staffOptions: StaffOption[];
  preview: CoursewareLecturePreview | null;
  /** 流程决策（提交/退回/通过/发布），客户端组件由调用方装配。 */
  decisionContent: ReactNode;
}) {
  const t = await getTranslations("school.lecture");
  const currentTrackState = detail.tracks.find((row) => row.track === track) ?? detail.tracks[0];
  const canEditThisTrack = currentTrackState && ["idle", "editing", "changes_requested"].includes(currentTrackState.stage);

  const primaryAction = canOpenCoursewareWorkbench && canEditThisTrack
    ? <Link href={`/studio/courseware/${detail.lecture.id}?track=${track}`} className={buttonVariants({ size: "sm" })}>{t("openWorkbench")}</Link>
    : undefined;

  const statusItems = detail.tracks.map((row) => {
    const { key, params } = lectureStageLabelKey(row);
    return {
      label: row.track === "adapted-4x3" ? t("trackAdapted") : t("trackNative"),
      value: t(key, params),
      tone: (row.stage === "changes_requested" || (row.internalDueAt && new Date(row.internalDueAt) < new Date())) ? "critical" as const : "default" as const,
    };
  });

  const effectiveOwner = detail.effectiveAssignments.find((row) => row.responsibility === "owner");

  return <ObjectWorkspace
    scroll="internal"
    objectBar={<ObjectBar
      title={t("lectureTitle", { no: detail.lecture.no, name: detail.lecture.name })}
      backHref={backHref}
      backLabel={t("backToVariant")}
      context={[{ value: detail.variant.title }]}
      status={detail.tracks.find((row) => row.hasUnpublishedChanges) ? <AlertTriangle size={16} className="text-amber-600" aria-label={t("hasUnpublishedChanges")} /> : undefined}
      primaryAction={primaryAction}
    />}
    navigation={<TrackSwitcher
      items={[
        { value: "native-16x9", label: t("trackNative"), href: trackHref(baseHref, "native-16x9", returnTo) },
        { value: "adapted-4x3", label: t("trackAdapted"), href: trackHref(baseHref, "adapted-4x3", returnTo) },
      ]}
      activeValue={track}
      ariaLabel={t("trackSwitcherLabel")}
    />}
    statusStrip={<StatusStrip items={statusItems} />}
  >
    <WorkspaceSplitShell
      main={
        <WorkspaceMain contentClassName="gap-4">
          {/* 目标压成一条紧凑摘要：它是判断预览对不对的尺子，不是这一页的正文。 */}
          <section className="rounded-2xl border border-line bg-card px-4 py-3">
            <h2 className="text-xs uppercase tracking-[0.14em] text-muted">{t("objectives")}</h2>
            <p className="mt-1 text-sm leading-6 text-ink">{detail.lecture.objectives || t("noObjectives")}</p>
          </section>

          <section className="rounded-2xl border border-line bg-card p-4">
            <h2 className="text-sm font-medium text-ink">{t("authoritativePreview")}</h2>
            {preview ? (
              <div className="mt-3">
                <LectureCoursewarePreview
                  preview={preview}
                  prevHref={preview.pageIndex > 1 ? pageHref(baseHref, track, preview.pageIndex - 1, returnTo) : null}
                  nextHref={preview.pageIndex < preview.pages.length ? pageHref(baseHref, track, preview.pageIndex + 1, returnTo) : null}
                  pageHrefs={preview.pages.map((_, index) => pageHref(baseHref, track, index + 1, returnTo))}
                />
              </div>
            ) : <p className="mt-2 text-sm text-muted">{t("previewUnavailable")}</p>}
          </section>
        </WorkspaceMain>
      }
      rail={
        <WorkspaceRail title={t("decisionRailTitle")}>
          {decisionContent}

          <ResponsibilityPanel
            scopeType="lecture"
            scopeId={detail.lecture.id}
            assignments={detail.assignments}
            staffOptions={staffOptions}
            canManage={canAssign}
            title={t("lectureResponsibility")}
          />
          {effectiveOwner && (
            <p className="text-xs text-muted">
              {t("effectiveOwner", { name: effectiveOwner.userName })}
              {effectiveOwner.sourceLabel && <span className="ml-1">({t("effectiveOwnerSource", { source: effectiveOwner.sourceLabel })})</span>}
            </p>
          )}

          <section>
            <h3 className="text-xs uppercase tracking-[0.14em] text-muted">{t("usageRailTitle")}</h3>
            {detail.usage.length === 0 ? <p className="mt-2 text-sm text-muted">{t("usageEmpty")}</p> : (
              <ul className="mt-2 divide-y divide-line">
                {detail.usage.map((row) => <li key={row.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                  <Link href={`/dashboard/classes/${row.classroomId}`} className="min-w-0 truncate text-ink hover:text-crater">{row.classroomName}</Link>
                  <span className="shrink-0 text-xs text-muted">{row.scheduledAt ? new Date(row.scheduledAt).toLocaleDateString() : "—"}</span>
                </li>)}
              </ul>
            )}
          </section>
        </WorkspaceRail>
      }
    />
  </ObjectWorkspace>;
}

import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import type { SessionWorkspaceDetail } from "./classes";
import { SessionLivePanel } from "./SessionLivePanel";
import { SessionPostworkPanel } from "./SessionPostworkPanel";
import { SessionPrepPanel } from "./SessionPrepPanel";
import {
  ObjectBar,
  ObjectWorkspace,
  preserveReturnTo,
  StageNavigation,
  WorkspaceMain,
  WorkspaceSplitShell,
  type ObjectContextItem,
} from "./object-workspace";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { Presentation } from "lucide-react";
import { NotificationFocus } from "@/features/events/NotificationFocus";
import { SessionPrepCompleteAction, SessionPrepCopyAction } from "./SessionPrepActions";
import { AttendanceDrawer } from "./AttendanceDrawer";
import { SessionCompletePostworkButton } from "./SessionCompletePostworkButton";

const STAGES = ["pre", "live", "post"] as const;
export type SessionStage = (typeof STAGES)[number];

/**
 * 缺省阶段跟着课次的真实状态走（doc 23 §10）：进行中落在课堂、已下课落在课后。
 * 固定落"课前"会让一节已经上完的课打开时停在一个无事可做的空面板上，
 * 而右边的 Rail 正写着"下一步：处理课后"。
 */
export function parseSessionStage(value: string | undefined, state?: SessionWorkspaceDetail["state"]): SessionStage {
  if (STAGES.includes(value as SessionStage)) return value as SessionStage;
  if (state === "started") return "live";
  if (state === "ended") return "post";
  return "pre";
}

/**
 * 主动作算法（doc19 §14 "主动作算法"）：primaryAction 恒为 Link，非教学角色
 * （只审阅，doc §14.8）不显示；否则按事件状态 + 工作状态挑一个下一步。
 */
function resolvePrimaryAction(
  detail: SessionWorkspaceDetail,
  stageHref: (stage: SessionStage) => string,
  t: (key: string, values?: Record<string, string | number>) => string,
) {
  const { capabilities, state, prepStatus } = detail;
  if (!capabilities.canPrepare && !capabilities.canEnterLive) return undefined;

  if (state === "scheduled") {
    if (prepStatus === "not_started" || prepStatus === "in_progress") return undefined;
    return { href: `/classroom/${detail.classroomId}/session/${detail.id}/live`, label: t("enterCandidate") };
  }
  if (state === "started") {
    return { href: `/classroom/${detail.classroomId}/session/${detail.id}/live`, label: t("enterClassroom") };
  }
  if (state === "ended" && !detail.postworkCompletedAt) {
    return { href: stageHref("post"), label: t("handlePostwork") };
  }
  return undefined;
}

/**
 * 课次工作区（doc 23 §10）。
 *
 * 三个阶段面板原样保留，外部骨架重写：
 *   - `?tab=` 硬切成 `?stage=`。这三段不是并列视图而是一条有先后的流程，
 *     URL 上说 "tab" 会让"课前没做完就进课堂"看起来只是换了个页签。
 *   - 阶段切换从语义不清的 ContextBar 换成 StageNavigation。
 *   - 课前动作与阶段导航同行，正文只保留备课流程和课件工作区，避免重复的课次决策栏挤压画布。
 */
export async function SessionWorkspaceBody({
  detail,
  stage,
  backHref,
  returnTo,
  focusTarget,
}: {
  detail: SessionWorkspaceDetail;
  stage: SessionStage;
  /** 已过 resolveReturnTarget 校验的来源地址（默认班级详情）。 */
  backHref: string;
  /** 已校验的 `?returnTo=`；课前/课堂/课后三段之间切换要带着它走（doc24 §6）。 */
  returnTo: string | null;
  focusTarget?: string;
}) {
  const t = await getTranslations("school.session");
  const tc = await getTranslations("school.classes");

  const baseHref = `/dashboard/sessions/${detail.id}`;
  const stageHref = (target: SessionStage) =>
    preserveReturnTo(`${baseHref}?stage=${target}`, returnTo);

  const statusLabel = {
    scheduled_not_ready: t("status_scheduledNotReady"),
    scheduled_ready: t("status_scheduledReady"),
    imminent: t("status_imminent"),
    live: tc("statusLive"),
    ended_pending: t("status_endedPending"),
    completed: t("status_completed"),
    cancelled: tc("statusCancelled"),
    voided: tc("statusVoided"),
  }[detail.statusLabelKey];

  // §10：身份行补齐"班级 · 日期时间 · 时长"——原来只有讲次号和时长，
  // 从课表点进来的人无从判断这是哪个班的课。
  const contextItems: ObjectContextItem[] = ([
    { value: detail.classroomName },
    detail.scheduledAt ? { value: new Date(detail.scheduledAt).toLocaleString() } : null,
    detail.durationMin ? { value: t("durationMin", { count: detail.durationMin }) } : null,
    detail.no ? { value: t("lectureNo", { no: detail.no }) } : null,
  ] satisfies (ObjectContextItem | null)[]).filter((item) => item !== null);

  const primaryAction = resolvePrimaryAction(detail, stageHref, t);

  return (
    <ObjectWorkspace
      scroll="internal"
      objectBar={
        <ObjectBar
          title={detail.name || t("untitledSession")}
          backHref={backHref}
          backLabel={t("backToClassroom")}
          context={contextItems}
          status={<Badge variant="secondary">{statusLabel}</Badge>}
          primaryAction={primaryAction && (
            <Link href={primaryAction.href} className={cn(buttonVariants({ size: "sm" }))}>{primaryAction.label}</Link>
          )}
        />
      }
      navigation={
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <StageNavigation
              items={STAGES.map((value) => ({ value, label: t(`stage_${value}`), href: stageHref(value) }))}
              activeValue={stage}
              ariaLabel={t("stageNavLabel")}
            />
            {stage === "pre" && detail.capabilities.canPrepare && detail.state === "scheduled" && detail.lectureId ? (
              <SessionPrepCopyAction
                sessionId={detail.id}
                prepStatus={detail.prepStatus}
              />
            ) : null}
          </div>
          {stage === "pre" && detail.capabilities.canPrepare && detail.state === "scheduled" && detail.lectureId ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Link
                href={"/classroom/" + detail.classroomId + "/session/" + detail.id + "/live?mode=rehearsal"}
                className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "gap-2")}
              >
                <Presentation size={15} />
                {t("rehearse")}
              </Link>
              <SessionPrepCompleteAction
                sessionId={detail.id}
                prepStatus={detail.prepStatus}
                hasRelease={detail.currentReleaseNo !== null}
                hasUnpublishedChanges={detail.hasUnpublishedChanges}
              />
            </div>
          ) : null}
          {stage === "post" ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {detail.capabilities.canMarkAttendance && (
                <AttendanceDrawer sessionId={detail.id} mode="amend" appearance="secondary" />
              )}
              <SessionCompletePostworkButton
                sessionId={detail.id}
                completed={Boolean(detail.postworkCompletedAt)}
                disabled={!detail.capabilities.canCompletePostwork}
              />
            </div>
          ) : null}
        </div>
      }
    >
      <WorkspaceSplitShell
        main={
          <WorkspaceMain
            scroll={stage === "pre" ? "none" : "auto"}
            contentClassName={stage === "pre" ? "h-full min-h-0 !py-3" : undefined}
          >
            <NotificationFocus target={focusTarget} />
            {stage === "pre" && <SessionPrepPanel detail={detail} />}
            {stage === "live" && <SessionLivePanel detail={detail} />}
            {stage === "post" && <SessionPostworkPanel detail={detail} />}
          </WorkspaceMain>
        }
      />
    </ObjectWorkspace>
  );
}

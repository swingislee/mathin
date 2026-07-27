import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import type { SessionWorkspaceDetail } from "./classes";
import { SessionLivePanel } from "./SessionLivePanel";
import { SessionPostworkPanel } from "./SessionPostworkPanel";
import { SessionPrepPanel } from "./SessionPrepPanel";
import { SessionWorkspaceRail } from "./SessionWorkspaceRail";
import {
  ObjectBar,
  ObjectWorkspace,
  StageNavigation,
  WorkspaceMain,
  WorkspaceRail,
  WorkspaceSplitShell,
  type ObjectContextItem,
} from "./object-workspace";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";

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
    if (prepStatus === "not_started" || prepStatus === "in_progress") {
      return { href: stageHref("pre"), label: prepStatus === "not_started" ? t("startPrep") : t("completePrep") };
    }
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
 *   - 主区旁边补上 Rail：课次摘要 / 完成状态 / 下一步。原来这一页右边什么都没有，
 *     三个面板轮流独占整宽，"这节课是哪个班、几点、还差什么"要切回课前面板才看得到。
 */
export async function SessionWorkspaceBody({
  detail,
  stage,
  backHref,
}: {
  detail: SessionWorkspaceDetail;
  stage: SessionStage;
  /** 已过 resolveReturnTarget 校验的来源地址（默认班级详情）。 */
  backHref: string;
}) {
  const t = await getTranslations("school.session");
  const tc = await getTranslations("school.classes");

  const baseHref = `/dashboard/sessions/${detail.id}`;
  const stageHref = (target: SessionStage) => `${baseHref}?stage=${target}`;

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
        <StageNavigation
          items={STAGES.map((value) => ({ value, label: t(`stage_${value}`), href: stageHref(value) }))}
          activeValue={stage}
          ariaLabel={t("stageNavLabel")}
        />
      }
    >
      <WorkspaceSplitShell
        main={
          <WorkspaceMain>
            {stage === "pre" && <SessionPrepPanel detail={detail} />}
            {stage === "live" && <SessionLivePanel detail={detail} />}
            {stage === "post" && <SessionPostworkPanel detail={detail} />}
          </WorkspaceMain>
        }
        rail={
          <WorkspaceRail title={t("railTitle")}>
            <SessionWorkspaceRail detail={detail} stageHref={stageHref} />
          </WorkspaceRail>
        }
      />
    </ObjectWorkspace>
  );
}

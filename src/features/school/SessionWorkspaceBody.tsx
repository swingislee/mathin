import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import type { SessionWorkspaceDetail } from "./classes";
import { SessionLivePanel } from "./SessionLivePanel";
import { SessionPostworkPanel } from "./SessionPostworkPanel";
import { SessionPrepPanel } from "./SessionPrepPanel";
import { ContextBar } from "./stage/ContextBar";
import { ObjectBar } from "./stage/ObjectBar";
import { ObjectWorkspace } from "./stage/ObjectWorkspace";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";

const TABS = ["pre", "live", "post"] as const;
export type SessionTab = (typeof TABS)[number];

/**
 * 主动作算法（doc19 §14 "主动作算法"）：primaryAction 恒为 Link（P4I-11/12/13 一致的
 * 惯例），非教学角色（只审阅，doc §14.8）不显示；否则按事件状态 + 工作状态挑一个下一步。
 */
function resolvePrimaryAction(
  detail: SessionWorkspaceDetail,
  baseHref: string,
  t: (key: string, values?: Record<string, string | number>) => string,
) {
  const { capabilities, state, prepStatus } = detail;
  if (!capabilities.canPrepare && !capabilities.canEnterLive) return undefined;

  if (state === "scheduled") {
    if (prepStatus === "not_started" || prepStatus === "in_progress") {
      return { href: `${baseHref}?tab=pre`, label: prepStatus === "not_started" ? t("startPrep") : t("completePrep") };
    }
    return { href: `/classroom/${detail.classroomId}/session/${detail.id}/live`, label: t("enterCandidate") };
  }
  if (state === "started") {
    return { href: `/classroom/${detail.classroomId}/session/${detail.id}/live`, label: t("enterClassroom") };
  }
  if (state === "ended" && !detail.postworkCompletedAt) {
    return { href: `${baseHref}?tab=post`, label: t("handlePostwork") };
  }
  return undefined;
}

export async function SessionWorkspaceBody({ detail, activeTab }: { detail: SessionWorkspaceDetail; activeTab: SessionTab }) {
  const t = await getTranslations("school.session");
  const tc = await getTranslations("school.classes");

  const classroomHref = `/dashboard/classes/${detail.classroomId}`;
  const baseHref = `/dashboard/sessions/${detail.id}`;

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

  const contextSummary = [
    detail.no ? t("lectureNo", { no: detail.no }) : null,
    detail.durationMin ? t("durationMin", { count: detail.durationMin }) : null,
  ].filter(Boolean).join(" · ");

  const primaryAction = resolvePrimaryAction(detail, baseHref, t);

  return (
    <ObjectWorkspace
      scroll="internal"
      objectBar={
        <ObjectBar
          title={detail.name || t("untitledSession")}
          backHref={classroomHref}
          backLabel={t("backToClassroom")}
          context={contextSummary || undefined}
          status={<Badge variant="secondary">{statusLabel}</Badge>}
          primaryAction={primaryAction && (
            <Link href={primaryAction.href} className={cn(buttonVariants({ size: "sm" }))}>{primaryAction.label}</Link>
          )}
        />
      }
      contextBar={
        <ContextBar
          tabs={TABS.map((tab) => ({ value: tab, label: t(`tab_${tab}`), href: `${baseHref}?tab=${tab}` }))}
          activeTab={activeTab}
        />
      }
    >
      {activeTab === "pre" && <SessionPrepPanel detail={detail} />}
      {activeTab === "live" && <SessionLivePanel detail={detail} />}
      {activeTab === "post" && <SessionPostworkPanel detail={detail} />}
    </ObjectWorkspace>
  );
}

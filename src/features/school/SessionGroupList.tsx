import { MoreHorizontal } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { groupClassroomSessions, type SessionRow } from "./classes";
import type { WorkItemRow } from "./stage/types";

function stateLabel(t: Awaited<ReturnType<typeof getTranslations>>, session: SessionRow) {
  return session.state === "ended" ? t("statusEnded")
    : session.state === "started" ? t("statusLive")
    : session.state === "cancelled" ? t("statusCancelled")
    : session.state === "voided" ? t("statusVoided")
    : t("statusScheduled");
}

/**
 * 统一点击合同（doc19 §13.3）：主体→课次工作区；⋯→快速管理（原地开 Sheet，query 驱动）；
 * 进入教室→Classroom（仅 canEnterLive 时显示），三者互不吞并，不再按权限让整行跳到不同系统。
 */
async function SessionRowItem({ classroomId, session, quickManageHref }: { classroomId: string; session: SessionRow; quickManageHref: string }) {
  const t = await getTranslations("school.classes");

  return (
    <li className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
      <Link
        href={`/dashboard/sessions/${session.id}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1 transition-colors hover:bg-moon/20"
      >
        <span className="w-10 shrink-0 font-mono text-xs text-muted">{session.no ?? "-"}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{session.name || t("untitledSession")}</span>
        <Badge variant="secondary">{stateLabel(t, session)}</Badge>
        {session.teacherOverrideName && <Badge variant="outline">{t("substituteBy", { name: session.teacherOverrideName })}</Badge>}
      </Link>
      {session.capabilities.canEnterLive && (
        <Link href={`/classroom/${classroomId}/session/${session.id}`} className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink transition hover:border-crater">
          {t("openClassroom")}
        </Link>
      )}
      <Link
        href={quickManageHref}
        aria-label={t("quickManage")}
        className="flex shrink-0 items-center justify-center rounded-full border border-line p-1.5 text-muted transition hover:border-crater hover:text-ink"
      >
        <MoreHorizontal size={15} />
      </Link>
    </li>
  );
}

async function SessionGroupSection({ titleKey, count, classroomId, sessions, collapsible }: {
  titleKey: string;
  count: number;
  classroomId: string;
  sessions: SessionRow[];
  collapsible?: boolean;
}) {
  const t = await getTranslations("school.classes");
  if (sessions.length === 0) return null;
  const rows = <ul className="mt-2 divide-y divide-line">
    {sessions.map((session) => <SessionRowItem
      key={session.id}
      classroomId={classroomId}
      session={session}
      quickManageHref={`/dashboard/classes/${classroomId}?tab=sessions&session=${session.id}`}
    />)}
  </ul>;
  if (collapsible) {
    return <details className="border-t border-line pt-3">
      <summary className="cursor-pointer text-sm text-muted hover:text-ink">{t(titleKey, { count })}</summary>
      {rows}
    </details>;
  }
  return <div>
    <h3 className="text-xs font-medium uppercase text-muted">{t(titleKey, { count })}</h3>
    {rows}
  </div>;
}

export async function SessionGroupList({ classroomId, sessions, workItems }: {
  classroomId: string;
  sessions: SessionRow[];
  workItems: readonly WorkItemRow[];
}) {
  const t = await getTranslations("school.classes");
  const groups = groupClassroomSessions(sessions, workItems);
  const isEmpty = !groups.next && groups.needsAttention.length === 0 && groups.upcoming.length === 0
    && groups.ended.length === 0 && groups.cancelled.length === 0;

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <h2 className="font-medium">{t("sessions", { count: sessions.length })}</h2>
      {isEmpty ? (
        <p className="mt-4 text-sm text-muted">{t("emptySessions")}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {groups.next && (
            <div>
              <h3 className="text-xs font-medium uppercase text-muted">{t("groupNext")}</h3>
              <ul className="mt-2 divide-y divide-line">
                <SessionRowItem classroomId={classroomId} session={groups.next} quickManageHref={`/dashboard/classes/${classroomId}?tab=sessions&session=${groups.next.id}`} />
              </ul>
            </div>
          )}
          <SessionGroupSection titleKey="groupNeedsAttention" count={groups.needsAttention.length} classroomId={classroomId} sessions={groups.needsAttention} />
          <SessionGroupSection titleKey="groupUpcoming" count={groups.upcoming.length} classroomId={classroomId} sessions={groups.upcoming} />
          <SessionGroupSection titleKey="groupEnded" count={groups.ended.length} classroomId={classroomId} sessions={groups.ended} collapsible />
          <SessionGroupSection titleKey="groupCancelled" count={groups.cancelled.length} classroomId={classroomId} sessions={groups.cancelled} collapsible />
        </div>
      )}
    </section>
  );
}

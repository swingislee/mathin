import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import type { SessionRow } from "./classes";

function sessionHref(classroomId: string, session: SessionRow): string | null {
  const { canPrepare, canEnterLive, ...drawerCapabilities } = session.capabilities;
  if (canPrepare || canEnterLive) {
    return `/classroom/${classroomId}/session/${session.id}`;
  }
  const hasDrawerAction = Object.entries(drawerCapabilities).some(([key, value]) => key !== "reasons" && value === true);
  if (hasDrawerAction) {
    return `/dashboard/classes/${classroomId}?tab=sessions&session=${session.id}`;
  }
  return null;
}

async function SessionRowItem({ classroomId, session }: { classroomId: string; session: SessionRow }) {
  const t = await getTranslations("school.classes");
  const href = sessionHref(classroomId, session);
  const stateLabel = session.state === "ended" ? t("statusEnded")
    : session.state === "started" ? t("statusLive")
    : session.state === "cancelled" ? t("statusCancelled")
    : session.state === "voided" ? t("statusVoided")
    : t("statusScheduled");

  const content = (
    <>
      <span className="w-10 shrink-0 font-mono text-xs text-muted">{session.no ?? "-"}</span>
      <span className="min-w-0 flex-1 truncate font-medium">{session.name || t("untitledSession")}</span>
      <Badge variant="secondary">{stateLabel}</Badge>
      {session.teacherOverrideName && <Badge variant="outline">{t("substituteBy", { name: session.teacherOverrideName })}</Badge>}
    </>
  );

  if (!href) {
    return <li className="flex flex-wrap items-center gap-3 py-2.5 text-sm">{content}</li>;
  }
  return (
    <li>
      <Link
        href={href}
        className="flex flex-wrap items-center gap-3 rounded-lg py-2.5 text-sm transition-colors hover:bg-moon/20"
      >
        {content}
      </Link>
    </li>
  );
}

export async function SessionGroupList({ classroomId, sessions }: { classroomId: string; sessions: SessionRow[] }) {
  const t = await getTranslations("school.classes");
  const cancelled = sessions.filter((session) => session.state === "cancelled");
  const active = sessions.filter((session) => session.state !== "cancelled");

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <h2 className="font-medium">{t("sessions", { count: sessions.length })}</h2>
      {active.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{t("emptySessions")}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {active.map((session) => <SessionRowItem key={session.id} classroomId={classroomId} session={session} />)}
        </ul>
      )}
      {cancelled.length > 0 && (
        <details className="mt-4 border-t border-line pt-3">
          <summary className="cursor-pointer text-sm text-muted hover:text-ink">
            {t("cancelledGroup", { count: cancelled.length })}
          </summary>
          <ul className="mt-3 divide-y divide-line">
            {cancelled.map((session) => <SessionRowItem key={session.id} classroomId={classroomId} session={session} />)}
          </ul>
        </details>
      )}
    </section>
  );
}

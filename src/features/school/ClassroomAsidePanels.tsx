import { CircleAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { DashboardStatGrid, DashboardSummaryCard } from "@/features/school/dashboard-page";
import { withReturnTo } from "./object-workspace/return-target";
import { Link } from "@/i18n/navigation";
import type { ClassroomDetail, SessionGroups } from "./classes";
import { formatRoomLocation } from "./location-format";

/**
 * 班级页侧栏的稳定摘要（doc 23 §9）。
 *
 * 这几块信息原来分散在三处：人数和下一节课被拼进 ObjectBar 那条长字符串（滚不滚都
 * 只能看到被截断的一半），异常是正文顶部一条红色横幅（把它当"通知"而不是"待办"，
 * 于是切到别的 tab 就不见了），职责只存在于设置 Sheet 里（要点开才知道谁在带这个班）。
 *
 * 现在统一进 Aside：主栏是当前 tab 的工作面，侧栏回答"这个班当前是什么状况"——
 * 无论切到哪个 tab 都不变。
 *
 * 只读、不请求数据：全部来自页面已加载的 detail 与分组结果。
 */

export async function ClassroomSummary({ classroom }: { classroom: ClassroomDetail }) {
  const t = await getTranslations("school.classes");
  const ended = classroom.sessions.filter((session) => session.state === "ended").length;

  return (
    <DashboardSummaryCard title={t("classSummary")}>
      <DashboardStatGrid
        items={[
          {
            label: t("summaryRoster"),
            value: (
              <>
                {classroom.roster.length}
                {classroom.capacity ? <span className="text-sm text-muted"> / {classroom.capacity}</span> : null}
              </>
            ),
          },
          { label: t("summarySessions"), value: classroom.sessions.length },
          { label: t("summaryEnded"), value: ended },
          { label: t("summaryRoom"), value: formatRoomLocation(classroom.defaultRoomName, classroom.defaultRoomCampusName, t("roomTbd")) },
        ]}
      />
    </DashboardSummaryCard>
  );
}

export async function ClassroomNextSession({ next, returnTo }: { next: SessionGroups["next"]; returnTo: string }) {
  const t = await getTranslations("school.classes");
  return (
    <DashboardSummaryCard title={t("nextSessionTitle")}>
      {!next ? (
        <p className="mt-2 text-sm text-muted">{t("nextSessionEmpty")}</p>
      ) : (
        <div className="mt-2 text-sm">
          <p className="text-ink">{next.scheduledAt ? new Date(next.scheduledAt).toLocaleString() : t("notApplicable")}</p>
          <p className="mt-1 text-muted">
            {next.no !== null ? `${String(next.no).padStart(2, "0")} · ` : ""}
            {next.name || t("untitledSession")}
          </p>
          <Link href={withReturnTo(`/dashboard/sessions/${next.id}`, returnTo)} className="mt-2 inline-flex text-xs text-crater hover:underline">
            {t("openSessionWorkspace")}
          </Link>
        </div>
      )}
    </DashboardSummaryCard>
  );
}

export async function ClassroomRisks({ needsAttention, returnTo }: { needsAttention: SessionGroups["needsAttention"]; returnTo: string }) {
  const t = await getTranslations("school.classes");
  return (
    <DashboardSummaryCard title={t("riskTitle")}>
      {needsAttention.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t("riskNone")}</p>
      ) : (
        <>
          <p className="mt-2 flex items-start gap-1.5 text-sm text-rose">
            <CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
            {t("anomalySummary", { count: needsAttention.length })}
          </p>
          <ul className="mt-3 flex flex-col gap-1.5 text-sm">
            {needsAttention.slice(0, 5).map((session) => (
              <li key={session.id} className="min-w-0">
                <Link href={withReturnTo(`/dashboard/sessions/${session.id}`, returnTo)} className="block truncate text-ink hover:text-crater">
                  {session.no !== null ? `${String(session.no).padStart(2, "0")} · ` : ""}
                  {session.name || t("untitledSession")}
                </Link>
                <span className="text-xs text-muted">
                  {session.scheduledAt ? new Date(session.scheduledAt).toLocaleString() : t("notApplicable")}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </DashboardSummaryCard>
  );
}

export async function ClassroomResponsibility({ assignments }: { assignments: ClassroomDetail["staffAssignments"] }) {
  const t = await getTranslations("school.classes");
  return (
    <DashboardSummaryCard title={t("responsibilityTitle")}>
      {assignments.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t("responsibilityEmpty")}</p>
      ) : (
        <dl className="mt-3 flex flex-col gap-2 text-sm">
          {assignments.map((assignment) => (
            <div key={`${assignment.userId}-${assignment.responsibility}`} className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-xs text-muted">{t(`responsibility_${assignment.responsibility}`)}</dt>
              <dd className="min-w-0 truncate text-ink">{assignment.name}</dd>
            </div>
          ))}
        </dl>
      )}
    </DashboardSummaryCard>
  );
}

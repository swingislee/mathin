import { CircleAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { ClassroomDetail, SessionGroups } from "./classes";

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

function SummaryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <h2 className="text-sm font-medium text-ink">{title}</h2>
      {children}
    </section>
  );
}

export async function ClassroomSummary({ classroom }: { classroom: ClassroomDetail }) {
  const t = await getTranslations("school.classes");
  const ended = classroom.sessions.filter((session) => session.state === "ended").length;

  return (
    <SummaryCard title={t("classSummary")}>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <dt className="text-xs text-muted">{t("summaryRoster")}</dt>
          <dd className="mt-0.5 text-lg font-medium tabular-nums text-ink">
            {classroom.roster.length}
            {classroom.capacity ? <span className="text-sm text-muted"> / {classroom.capacity}</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t("summarySessions")}</dt>
          <dd className="mt-0.5 text-lg font-medium tabular-nums text-ink">{classroom.sessions.length}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t("summaryEnded")}</dt>
          <dd className="mt-0.5 text-lg font-medium tabular-nums text-ink">{ended}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t("summaryRoom")}</dt>
          <dd className="mt-0.5 truncate text-lg font-medium text-ink">{classroom.room || "—"}</dd>
        </div>
      </dl>
    </SummaryCard>
  );
}

export async function ClassroomNextSession({ next }: { next: SessionGroups["next"] }) {
  const t = await getTranslations("school.classes");
  return (
    <SummaryCard title={t("nextSessionTitle")}>
      {!next ? (
        <p className="mt-2 text-sm text-muted">{t("nextSessionEmpty")}</p>
      ) : (
        <div className="mt-2 text-sm">
          <p className="text-ink">{next.scheduledAt ? new Date(next.scheduledAt).toLocaleString() : t("notApplicable")}</p>
          <p className="mt-1 text-muted">
            {next.no !== null ? `${String(next.no).padStart(2, "0")} · ` : ""}
            {next.name || t("untitledSession")}
          </p>
          <Link href={`/dashboard/sessions/${next.id}`} className="mt-2 inline-flex text-xs text-crater hover:underline">
            {t("openSessionWorkspace")}
          </Link>
        </div>
      )}
    </SummaryCard>
  );
}

export async function ClassroomRisks({ needsAttention }: { needsAttention: SessionGroups["needsAttention"] }) {
  const t = await getTranslations("school.classes");
  return (
    <SummaryCard title={t("riskTitle")}>
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
                <Link href={`/dashboard/sessions/${session.id}`} className="block truncate text-ink hover:text-crater">
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
    </SummaryCard>
  );
}

export async function ClassroomResponsibility({ assignments }: { assignments: ClassroomDetail["staffAssignments"] }) {
  const t = await getTranslations("school.classes");
  return (
    <SummaryCard title={t("responsibilityTitle")}>
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
    </SummaryCard>
  );
}

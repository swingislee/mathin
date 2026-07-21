import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getSessionWorkspaceDetail } from "@/features/school/classes";
import { ObjectBar } from "@/features/school/stage/ObjectBar";
import { ObjectWorkspace } from "@/features/school/stage/ObjectWorkspace";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * P4I-13 canonical 课次工作区 stub：只保证鉴权、身份展示与"进入教室"主动作。
 * 课前/课堂/课后三段结构、本次覆盖、备课复制、冻结留给 P4I-14——本页不抢跑。
 */
export default async function SessionWorkspacePage({
  params,
}: {
  params: Promise<{ locale: string; sessionId: string }>;
}) {
  const { locale, sessionId } = await params;
  setRequestLocale(locale);
  await requireUser(locale);
  if (!UUID_PATTERN.test(sessionId)) notFound();

  const [t, detail] = await Promise.all([
    getTranslations("school.session"),
    getSessionWorkspaceDetail(sessionId),
  ]);
  if (!detail) notFound();

  const tc = await getTranslations("school.classes");
  const stateLabel = detail.state === "ended" ? tc("statusEnded")
    : detail.state === "started" ? tc("statusLive")
    : detail.state === "cancelled" ? tc("statusCancelled")
    : detail.state === "voided" ? tc("statusVoided")
    : tc("statusScheduled");

  const classroomHref = `/dashboard/classes/${detail.classroomId}`;
  const primaryAction = detail.capabilities.canEnterLive
    ? <Link href={`/classroom/${detail.classroomId}/session/${detail.id}`} className={buttonVariants({ size: "sm" })}>{t("enterClassroom")}</Link>
    : undefined;

  return <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col xl:h-full xl:min-h-0">
    <ObjectWorkspace
      scroll="internal"
      objectBar={<ObjectBar
        title={detail.name || t("untitledSession")}
        backHref={classroomHref}
        backLabel={t("backToClassroom")}
        context={detail.no ? t("lectureNo", { no: detail.no }) : undefined}
        status={<Badge variant="secondary">{stateLabel}</Badge>}
        primaryAction={primaryAction}
      />}
    >
      <div className="flex flex-col gap-4 px-1">
        <section className="rounded-2xl border border-line bg-card p-4 text-sm">
          <dl className="grid gap-2">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{t("scheduledAt")}</dt>
              <dd className="text-ink">{detail.scheduledAt ? new Date(detail.scheduledAt).toLocaleString() : tc("notApplicable")}</dd>
            </div>
            {detail.teacherOverrideName && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{tc("substitute")}</dt>
                <dd className="text-ink">{detail.teacherOverrideName}</dd>
              </div>
            )}
          </dl>
        </section>
        <p className="text-sm text-muted">{t("moreComingSoon")}</p>
      </div>
    </ObjectWorkspace>
  </div>;
}

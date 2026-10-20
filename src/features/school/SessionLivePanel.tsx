import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import type { SessionWorkspaceSummary } from "./classes";
import { DashboardIntentLink } from "./dashboard-page/DashboardIntentLink";
import { cn } from "@/lib/utils";

/**
 * 课堂（doc19 §14.8）：课堂本体仍是 `/classroom/.../live`（真实白板/实时频道），
 * 本页只展示状态卡片；主管/教务/学服在这里只审阅状态，不获得实时频道或课堂资产权限。
 */
export async function SessionLivePanel({ detail }: { detail: SessionWorkspaceSummary }) {
  const t = await getTranslations("school.session");
  const tPreparation = await getTranslations("classroom.preparation");
  const liveHref = `/classroom/${detail.classroomId}/session/${detail.id}/live`;

  return (
    <div className="flex flex-col gap-4 px-1">
      <section className="rounded-2xl border border-line bg-card p-4 text-sm">
        <p className="text-ink">
          {detail.state === "started" ? t("liveInProgress") : detail.state === "ended" ? t("liveEnded") : t("liveNotStarted")}
        </p>
        {detail.capabilities.canEnterLive ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <DashboardIntentLink href={`${liveHref}?entry=prep`} className={buttonVariants({ size: "sm", variant: detail.state === "started" ? "secondary" : "primary" })}>
              {tPreparation("entry")}
            </DashboardIntentLink>
            {detail.state === "started" && <DashboardIntentLink href={liveHref} className={cn(buttonVariants({ size: "sm" }))}>
              {tPreparation("actions.resume")}
            </DashboardIntentLink>}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted">{t("liveReviewOnly")}</p>
        )}
      </section>
    </div>
  );
}

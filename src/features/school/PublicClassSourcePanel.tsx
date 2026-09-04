import { CalendarDays, ExternalLink } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { DashboardSummaryCard } from "@/features/school/dashboard-page";
import { Link } from "@/i18n/navigation";
import type { LinkedPublicClassSummary } from "./public-class";

export async function PublicClassSourcePanel({
  activities,
  locale,
}: {
  activities: LinkedPublicClassSummary[];
  locale: string;
}) {
  if (activities.length === 0) return null;
  const t = await getTranslations("school.publicClass");
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Asia/Shanghai" });
  return <DashboardSummaryCard title={t("classSourceTitle")}>
    <p className="mt-1 text-xs text-muted">{t("classSourceHint")}</p>
    <ul className="mt-3 space-y-3">
      {activities.map((activity) => <li key={activity.activityId} className="border-l-2 border-crater/30 pl-3">
        <Link href={`/dashboard/activities/${activity.activityId}?view=review`} className="group block min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-medium text-ink group-hover:text-crater">
            <span className="min-w-0 flex-1 truncate">{activity.title}</span><ExternalLink className="size-3.5 shrink-0" />
          </span>
          <span className="mt-1 flex items-center gap-1 text-xs text-muted"><CalendarDays className="size-3" />{date.format(new Date(activity.scheduledAt))} · {t("candidateCount", { count: activity.candidateCount })}</span>
        </Link>
      </li>)}
    </ul>
  </DashboardSummaryCard>;
}

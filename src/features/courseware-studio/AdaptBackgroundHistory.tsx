"use client";

import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { AdaptBackgroundHistory as AdaptBackgroundHistoryData } from "./adapt-review-data";

function pageHref(page: number, courseId: string | null, lectureId: string | null) {
  const query = new URLSearchParams({ tab: "history", page: String(page) });
  if (courseId) query.set("course", courseId);
  if (lectureId) query.set("lecture", lectureId);
  return "/dashboard/courseware/review?" + query.toString();
}

export function AdaptBackgroundHistory({ items, page, total, totalPages, courseId, lectureId }: AdaptBackgroundHistoryData & { courseId: string | null; lectureId: string | null }) {
  const t = useTranslations("coursewareStudio");
  return <section className="mt-6">
    <div className="rounded-2xl border border-line bg-card p-4">
      <h2 className="font-display text-lg text-ink">{t("adaptHistoryTitle")}</h2>
      <p className="mt-1 text-sm text-muted">{t("adaptHistoryIntro")}</p>
    </div>
    {items.length === 0 ? <p className="mt-4 rounded-2xl border border-dashed border-line bg-card p-8 text-center text-sm text-muted">{t("adaptHistoryEmpty")}</p> : <div className="mt-4 space-y-3">
      {items.map((item) => <article key={item.id} className="rounded-2xl border border-line bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{t(item.status === "superseded" ? "adaptHistorySuperseded" : "adaptHistoryRepaired")}</Badge>
              {item.rejectionCode ? <Badge variant="secondary">{t(`adaptRejectReason_${item.rejectionCode}`)}</Badge> : null}
            </div>
            <p className="mt-2 text-sm font-medium text-ink">{item.courseTitle && item.lectureNo !== null ? t("adaptHistoryLocation", { course: item.courseTitle, lecture: item.lectureNo, page: item.pageNo ?? "—" }) : t("adaptHistoryNoCurrentUsage")}</p>
            <p className="mt-1 text-sm text-muted">{item.note || t("adaptHistoryNoNote")}</p>
          </div>
          {item.lectureId && item.pageNo !== null ? <Link href={`/studio/courseware/${item.lectureId}?track=adapted-4x3`} className={buttonVariants({ variant: "ghost", size: "sm" })}>{t("adaptOpenLecture")}<ExternalLink className="size-3" /></Link> : null}
        </div>
        <dl className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-2 lg:grid-cols-4">
          <div><dt>{t("adaptHistoryRecord")}</dt><dd className="mt-1 truncate font-mono">{item.id}</dd></div>
          <div><dt>{t("adaptHistoryCrop")}</dt><dd className="mt-1">x {item.cropX}, y {item.cropY}</dd></div>
          <div><dt>{t("adaptHistorySuccessor")}</dt><dd className="mt-1 truncate font-mono">{item.supersededById ?? "—"}</dd></div>
          <div><dt>{t("adaptHistoryPages")}</dt><dd className="mt-1">{item.pageCount}</dd></div>
        </dl>
      </article>)}
    </div>}
    <nav className="mt-6 flex items-center justify-between gap-3" aria-label={t("adaptHistoryPagination")}>
      {page > 1 ? <Link href={pageHref(page - 1, courseId, lectureId)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}><ChevronLeft className="size-4" />{t("adaptPreviousPage")}</Link> : <span />}
      <p className="text-sm text-muted">{t("adaptHistoryPage", { page, totalPages, total })}</p>
      {page < totalPages ? <Link href={pageHref(page + 1, courseId, lectureId)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("adaptNextPage")}<ChevronRight className="size-4" /></Link> : <span />}
    </nav>
  </section>;
}

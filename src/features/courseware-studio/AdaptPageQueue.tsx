"use client";

import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { setAdaptPageClassificationAction } from "./adapt-actions";
import { ADAPT_CLASSES, type AdaptClass } from "./adapt-review-shared";
import type { AdaptPageQueue as AdaptPageQueueData, AdaptPageQueueItem } from "./adapt-review-data";

function hrefFor(classification: AdaptClass | "all", page: number) {
  return "/dashboard/adapt-review?tab=pages&class=" + classification + "&page=" + page;
}

export function AdaptPageQueue({ items, page, total, totalPages, classification, canEditPages }: AdaptPageQueueData & { canEditPages: boolean }) {
  const t = useTranslations("coursewareStudio");
  const router = useRouter();
  return <section className="mt-6">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card p-4">
      <div>
        <h2 className="text-base font-semibold text-ink">{t("adaptPageQueueTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("adaptPageQueueIntro")}</p>
      </div>
      <div className="w-40">
        <Select value={classification} onValueChange={(value) => router.push(hrefFor(value as AdaptClass | "all", 1))}>
          <SelectTrigger aria-label={t("adaptClassFilter")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("adaptClassAll")}</SelectItem>
            {ADAPT_CLASSES.map((item) => <SelectItem key={item} value={item}>{classLabel(t, item)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
    {items.length === 0 ? <p className="mt-4 rounded-2xl border border-dashed border-line bg-card p-8 text-center text-sm text-muted">{t("adaptPageQueueEmpty")}</p> : <div className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
      {items.map((item) => <AdaptPageRow key={item.id} item={item} canEditPages={canEditPages} />)}
    </div>}
    <nav className="mt-6 flex items-center justify-between gap-3" aria-label={t("adaptPagination")}>
      {page > 1 ? <Link href={hrefFor(classification, page - 1)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}><ChevronLeft className="size-4" />{t("adaptPreviousPage")}</Link> : <span />}
      <p className="text-sm text-muted">{t("adaptQueuePage", { page, totalPages, total })}</p>
      {page < totalPages ? <Link href={hrefFor(classification, page + 1)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("adaptNextPage")}<ChevronRight className="size-4" /></Link> : <span />}
    </nav>
  </section>;
}

function AdaptPageRow({ item, canEditPages }: { item: AdaptPageQueueItem; canEditPages: boolean }) {
  const t = useTranslations("coursewareStudio");
  const router = useRouter();
  const updateRun = useAction(
    (classification: AdaptClass) => setAdaptPageClassificationAction({ pageDocId: item.id, classification, note: "" }),
    { successMessage: t("adaptClassificationUpdated"), errorMessage: { default: t("adaptClassificationFailed") }, onSuccess: () => router.refresh() },
  );
  const studioHref = "/studio/courseware/" + item.lectureId + "?track=adapted-4x3&page=" + item.id;
  return <article className="flex flex-wrap items-center gap-3 p-4">
    <div className="min-w-0 flex-1">
      <p className="font-medium text-ink">{t("adaptPageLabel", { page: item.pageNo, title: item.title || t("untitledPage") })}</p>
      <p className="mt-1 text-xs text-muted">{item.adaptReason || t("adaptNoReason")}</p>
    </div>
    <Badge variant="outline">{classLabel(t, item.adaptClass)}</Badge>
    {canEditPages ? <div className="flex flex-wrap items-center gap-2">
      <Select value={item.adaptClass} onValueChange={(value) => updateRun.run(value as AdaptClass)} disabled={updateRun.pending}>
        <SelectTrigger className="w-28" aria-label={t("adaptClassSelect")}><SelectValue /></SelectTrigger>
        <SelectContent>{ADAPT_CLASSES.map((classification) => <SelectItem key={classification} value={classification}>{classLabel(t, classification)}</SelectItem>)}</SelectContent>
      </Select>
      <Link href={studioHref} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("adaptVisualEdit")}<ExternalLink className="size-4" /></Link>
    </div> : null}
  </article>;
}

function classLabel(t: ReturnType<typeof useTranslations>, classification: AdaptClass) {
  return classification + " · " + t("adaptClass" + classification);
}

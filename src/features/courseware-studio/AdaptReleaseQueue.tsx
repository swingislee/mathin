"use client";

import { Check, ChevronLeft, ChevronRight, ExternalLink, Rocket } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { publishAdaptReleasesAction } from "./adapt-release-actions";
import type { AdaptReleaseQueue as AdaptReleaseQueueData, AdaptReleaseScope } from "./adapt-review-data";

function queueHref(page: number, scope: AdaptReleaseScope, courseId: string | null, lectureId: string | null) {
  const query = new URLSearchParams({ tab: "releases", scope, page: String(page) });
  if (courseId) query.set("course", courseId);
  if (lectureId) query.set("lecture", lectureId);
  return `/dashboard/adapt-review?${query.toString()}`;
}

function isPublishable(item: AdaptReleaseQueueData["items"][number]) {
  return item.ready && (item.currentReleaseNo === null || item.hasUnpublishedChanges);
}

export function AdaptReleaseQueue({
  items,
  page,
  total,
  totalPages,
  scope,
  courseId,
  lectureId,
  canPublish,
}: AdaptReleaseQueueData & {
  courseId: string | null;
  lectureId: string | null;
  canPublish: boolean;
}) {
  const t = useTranslations("coursewareStudio");
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publishIds, setPublishIds] = useState<string[] | null>(null);
  const readyIds = useMemo(() => items.filter(isPublishable).map((item) => item.lectureId), [items]);
  const selectedIds = useMemo(() => readyIds.filter((id) => selected.has(id)), [readyIds, selected]);
  const allSelected = readyIds.length > 0 && selectedIds.length === readyIds.length;
  const publishRun = useAction(publishAdaptReleasesAction, {
    successMessage: t("adaptReleasePublished"),
    errorMessage: {
      ADAPT_BACKGROUND_REVIEW_REQUIRED: t("adaptReleaseBlocked"),
      ADAPT_RELEASE_NOT_READY: t("adaptReleaseBlocked"),
      PAGE_TRACK_NOT_READY: t("adaptReleaseBlocked"),
      UNRESOLVED_ASSET_BINDING: t("adaptReleaseBlocked"),
      default: t("adaptReleaseFailed"),
    },
    onSuccess: () => {
      setSelected(new Set());
      setPublishIds(null);
      router.refresh();
    },
  });
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(readyIds));

  return <section className="mt-6">
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-line bg-card p-4">
      <div>
        <h2 className="font-medium text-ink">{t("adaptReleaseQueueTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("adaptReleaseQueueIntro")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["pending", "published", "all"] as const).map((value) => <Link
          key={value}
          href={queueHref(1, value, courseId, lectureId)}
          className={cn(buttonVariants({ variant: scope === value ? "primary" : "secondary", size: "sm" }))}
        >{t(`adaptReleaseScope_${value}`)}</Link>)}
      </div>
    </div>

    {canPublish && readyIds.length > 0 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card p-3">
      <Button type="button" variant="ghost" size="sm" onClick={toggleAll} disabled={publishRun.pending}>
        <Check className="size-4" />{allSelected ? t("adaptClearSelection") : t("adaptSelectPublishablePage")}
      </Button>
      <Button type="button" size="sm" disabled={selectedIds.length === 0 || publishRun.pending} onClick={() => setPublishIds(selectedIds)}>
        <Rocket className="size-4" />{t("adaptPublishSelected", { count: selectedIds.length })}
      </Button>
    </div>}

    {items.length === 0 ? <p className="mt-4 rounded-2xl border border-dashed border-line bg-card p-8 text-center text-sm text-muted">{t("adaptReleaseQueueEmpty")}</p> : (
      <div className="mt-4 space-y-3">
        {items.map((item) => <article key={item.lectureId} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-card p-4">
          {canPublish && isPublishable(item) ? <Checkbox
            checked={selected.has(item.lectureId)}
            onCheckedChange={() => toggle(item.lectureId)}
            aria-label={t("adaptSelectLecture", { no: item.lectureNo })}
            disabled={publishRun.pending}
          /> : null}
          <div className="min-w-64 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium text-ink">{t("adaptLectureOption", { no: item.lectureNo, name: item.lectureName })}</h3>
              {item.currentReleaseNo && !item.hasUnpublishedChanges
                ? <Badge variant="outline">{t("adaptReleasePublishedBadge")}</Badge>
                : item.ready
                  ? <Badge variant="secondary">{t("adaptReleaseReady")}</Badge>
                  : <Badge variant="danger">{t("adaptReleaseBlockedBadge")}</Badge>}
              {item.currentReleaseNo ? <Badge variant="outline">Release {item.currentReleaseNo}</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-muted">{item.courseTitle} · {item.productCode ?? "—"}</p>
            <p className="mt-1 text-xs text-muted">
              {t("adaptReleaseMeta", { pages: item.pageCount, blockers: item.blockedBackgroundCount })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/dashboard/curriculum/lectures/${item.lectureId}?track=adapted-4x3`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
              <ExternalLink className="size-4" />{t("adaptOpenLecture")}
            </Link>
            {canPublish && isPublishable(item) && <Button type="button" size="sm" disabled={publishRun.pending} onClick={() => setPublishIds([item.lectureId])}>
              <Rocket className="size-4" />{t("publishLecture")}
            </Button>}
          </div>
        </article>)}
      </div>
    )}

    <nav className="mt-6 flex items-center justify-between gap-3" aria-label={t("adaptReleasePagination") }>
      {page > 1 ? <Link href={queueHref(page - 1, scope, courseId, lectureId)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
        <ChevronLeft className="size-4" />{t("adaptPreviousPage")}
      </Link> : <span />}
      <p className="text-sm text-muted">{t("adaptReleasePage", { page, totalPages, total })}</p>
      {page < totalPages ? <Link href={queueHref(page + 1, scope, courseId, lectureId)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
        {t("adaptNextPage")}<ChevronRight className="size-4" />
      </Link> : <span />}
    </nav>

    <ConfirmDialog
      open={publishIds !== null}
      onOpenChange={(open) => { if (!open && !publishRun.pending) setPublishIds(null); }}
      title={t("adaptPublishConfirmTitle")}
      description={t("adaptPublishConfirmDescription", { count: publishIds?.length ?? 0 })}
      confirmLabel={t("adaptPublishConfirm")}
      cancelLabel={t("adaptCancel")}
      onConfirm={() => { if (publishIds) publishRun.run({ lectureIds: publishIds, note: t("adaptPublishDefaultNote") }); }}
      pending={publishRun.pending}
    />
  </section>;
}

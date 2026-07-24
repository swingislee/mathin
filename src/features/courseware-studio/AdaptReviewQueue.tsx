"use client";
/* eslint-disable @next/next/no-img-element -- private, short-lived signed CAS URLs cannot use next/image. */

import { Check, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { reviewAdaptBackgroundsAction } from "./adapt-actions";
import type { AdaptReviewItem } from "./adapt-review-data";

type Decision = "approve" | "reject";
type PendingDecision = { decision: Decision; ids: string[] } | null;

function pageHref(page: number) {
  return "/dashboard/adapt-review?tab=backgrounds&page=" + page;
}

export function AdaptReviewQueue({ items, page, total, totalPages, canManageAssets }: { items: AdaptReviewItem[]; page: number; total: number; totalPages: number; canManageAssets: boolean }) {
  const t = useTranslations("coursewareStudio");
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingDecision, setPendingDecision] = useState<PendingDecision>(null);
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const selectedIds = useMemo(() => ids.filter((id) => selected.has(id)), [ids, selected]);
  const allSelected = ids.length > 0 && selectedIds.length === ids.length;
  const finish = () => {
    setSelected(new Set());
    setPendingDecision(null);
    router.refresh();
  };
  const approveRun = useAction(
    (adaptationIds: string[]) => reviewAdaptBackgroundsAction({ adaptationIds, decision: "approve" }),
    { successMessage: t("adaptReviewApproved"), errorMessage: { ADAPT_BACKGROUND_NOT_PENDING: t("adaptReviewStale"), default: t("adaptReviewFailed") }, onSuccess: finish },
  );
  const rejectRun = useAction(
    (adaptationIds: string[]) => reviewAdaptBackgroundsAction({ adaptationIds, decision: "reject" }),
    { successMessage: t("adaptReviewRejected"), errorMessage: { ADAPT_BACKGROUND_NOT_PENDING: t("adaptReviewStale"), default: t("adaptReviewFailed") }, onSuccess: finish },
  );
  const pending = approveRun.pending || rejectRun.pending;
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(ids));
  const requestDecision = (decision: Decision, requestedIds: string[]) => setPendingDecision({ decision, ids: requestedIds });
  const confirm = () => {
    if (!pendingDecision) return;
    if (pendingDecision.decision === "approve") approveRun.run(pendingDecision.ids);
    else rejectRun.run(pendingDecision.ids);
  };

  if (items.length === 0) return <p className="mt-6 rounded-2xl border border-dashed border-line bg-card p-8 text-center text-sm text-muted">{t("adaptQueueEmpty")}</p>;

  return <>
    <section className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card p-4">
        <div>
          <p className="text-sm font-medium text-ink">{t("adaptQueuePage", { page, totalPages, total })}</p>
          <p className="mt-1 text-xs text-muted">{t("adaptQueueVisualHint")}</p>
        </div>
        {canManageAssets ? <Badge variant="secondary">{t("adaptSelected", { count: selectedIds.length })}</Badge> : null}
      </div>
      {canManageAssets ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card p-3">
        <Button type="button" variant="ghost" size="sm" onClick={toggleAll} disabled={pending}>
          <Check className="size-4" />{allSelected ? t("adaptClearSelection") : t("adaptSelectAllPage")}
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={selectedIds.length === 0 || pending} onClick={() => requestDecision("reject", selectedIds)}>
            <RotateCcw className="size-4" />{t("adaptRejectSelected", { count: selectedIds.length })}
          </Button>
          <Button type="button" size="sm" disabled={selectedIds.length === 0 || pending} onClick={() => requestDecision("approve", selectedIds)}>
            <Check className="size-4" />{t("adaptApproveSelected", { count: selectedIds.length })}
          </Button>
        </div>
      </div> : null}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {items.map((item) => <article key={item.id} className="overflow-hidden rounded-2xl border border-line bg-card">
          <header className="flex items-start gap-3 border-b border-line px-4 py-3">
            {canManageAssets ? <Checkbox aria-label={t("adaptSelectItem")} checked={selected.has(item.id)} onCheckedChange={() => toggle(item.id)} disabled={pending} /> : null}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{t("adaptCrop", { x: item.cropX, y: item.cropY })}</p>
              <p className="mt-1 truncate font-mono text-[11px] text-muted">{item.id}</p>
            </div>
            {canManageAssets ? <div className="flex shrink-0 gap-1">
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => requestDecision("reject", [item.id])}>{t("adaptReject")}</Button>
              <Button type="button" size="sm" disabled={pending} onClick={() => requestDecision("approve", [item.id])}>{t("adaptApprove")}</Button>
            </div> : null}
          </header>
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <ReviewImage label={t("adaptSource")} image={item.source} aspectClass="aspect-video" />
            <ReviewImage label={t("adaptDerivative")} image={item.derived} aspectClass="aspect-[4/3]" />
          </div>
          {item.pageCount > 0 ? <p className="border-t border-line px-4 py-3 text-xs text-muted">{t("adaptRelatedPages", { count: item.pageCount })}</p> : null}
        </article>)}
      </div>
      <nav className="mt-6 flex items-center justify-between gap-3" aria-label={t("adaptPagination")}>
        {page > 1 ? <Link href={pageHref(page - 1)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}><ChevronLeft className="size-4" />{t("adaptPreviousPage")}</Link> : <span />}
        <p className="text-sm text-muted">{t("adaptQueuePage", { page, totalPages, total })}</p>
        {page < totalPages ? <Link href={pageHref(page + 1)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("adaptNextPage")}<ChevronRight className="size-4" /></Link> : <span />}
      </nav>
    </section>
    <ConfirmDialog
      open={pendingDecision !== null}
      onOpenChange={(open) => { if (!open && !pending) setPendingDecision(null); }}
      title={pendingDecision?.decision === "approve" ? t("adaptApproveConfirmTitle") : t("adaptRejectConfirmTitle")}
      description={pendingDecision ? t(pendingDecision.decision === "approve" ? "adaptApproveConfirmDescription" : "adaptRejectConfirmDescription", { count: pendingDecision.ids.length }) : ""}
      confirmLabel={pendingDecision?.decision === "approve" ? t("adaptApprove") : t("adaptReject")}
      cancelLabel={t("adaptCancel")}
      onConfirm={confirm}
      pending={pending}
    />
  </>;
}

function ReviewImage({ label, image, aspectClass }: { label: string; image: AdaptReviewItem["source"]; aspectClass: string }) {
  const t = useTranslations("coursewareStudio");
  return <figure className="min-w-0 rounded-xl border border-line p-2">
    <img src={image.url} alt={label} className={cn("w-full rounded-lg bg-paper object-contain", aspectClass)} />
    <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-x-2 text-xs text-muted">
      <span className="font-medium text-ink">{label}</span>
      <span>{t("adaptDimensions", { width: image.width ?? "—", height: image.height ?? "—" })}</span>
    </figcaption>
  </figure>;
}

"use client";
/* eslint-disable @next/next/no-img-element -- private, short-lived signed CAS URLs cannot use next/image. */

import { DashboardEmptyCard } from "@/features/school/dashboard-page";
import { Check, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { reviewAdaptBackgroundsAction } from "./adapt-actions";
import type { AdaptReviewItem } from "./adapt-review-data";
import { ADAPT_REJECTION_CODES, type AdaptRejectionCode } from "./adapt-review-shared";

type Decision = "approve" | "reject";
type PendingDecision = { decision: Decision; ids: string[] } | null;

function pageHref(page: number, courseId: string | null, lectureId: string | null) {
  const query = new URLSearchParams({ tab: "backgrounds", page: String(page) });
  if (courseId) query.set("course", courseId);
  if (lectureId) query.set("lecture", lectureId);
  return "/dashboard/courseware/review?" + query.toString();
}

export function AdaptReviewQueue({ items, page, total, totalPages, canManageAssets, courseId, lectureId }: { items: AdaptReviewItem[]; page: number; total: number; totalPages: number; canManageAssets: boolean; courseId: string | null; lectureId: string | null }) {
  const t = useTranslations("coursewareStudio");
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingDecision, setPendingDecision] = useState<PendingDecision>(null);
  const [rejectReason, setRejectReason] = useState<AdaptRejectionCode | "">("");
  const [rejectNote, setRejectNote] = useState("");
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const selectedIds = useMemo(() => ids.filter((id) => selected.has(id)), [ids, selected]);
  const allSelected = ids.length > 0 && selectedIds.length === ids.length;
  const finish = () => {
    setSelected(new Set());
    setPendingDecision(null);
    setRejectReason("");
    setRejectNote("");
    router.refresh();
  };
  const approveRun = useAction(
    (adaptationIds: string[]) => reviewAdaptBackgroundsAction({ adaptationIds, decision: "approve", rejectionCode: null, note: "" }),
    { successMessage: t("adaptReviewApproved"), errorMessage: { ADAPT_BACKGROUND_NOT_PENDING: t("adaptReviewStale"), default: t("adaptReviewFailed") }, onSuccess: finish },
  );
  const rejectRun = useAction(
    (input: { adaptationIds: string[]; rejectionCode: AdaptRejectionCode; note: string }) => reviewAdaptBackgroundsAction({ ...input, decision: "reject" }),
    {
      successMessage: t("adaptReviewRejected"),
      errorMessage: {
        ADAPT_BACKGROUND_NOT_PENDING: t("adaptReviewStale"),
        REJECTION_REASON_REQUIRED: t("adaptRejectReasonRequired"),
        REJECTION_NOTE_REQUIRED: t("adaptRejectNoteRequired"),
        default: t("adaptReviewFailed"),
      },
      onSuccess: finish,
    },
  );
  const pending = approveRun.pending || rejectRun.pending;
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(ids));
  const requestDecision = (decision: Decision, requestedIds: string[]) => {
    setPendingDecision({ decision, ids: requestedIds });
    if (decision === "reject") {
      setRejectReason("");
      setRejectNote("");
    }
  };
  const confirmApprove = () => {
    if (pendingDecision?.decision === "approve") approveRun.run(pendingDecision.ids);
  };
  const confirmReject = () => {
    if (pendingDecision?.decision !== "reject" || !rejectReason) return;
    rejectRun.run({ adaptationIds: pendingDecision.ids, rejectionCode: rejectReason, note: rejectNote });
  };

  if (items.length === 0) return <DashboardEmptyCard>{t("adaptQueueEmpty")}</DashboardEmptyCard>;

  return <>
    <section className="min-w-0">
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
        {page > 1 ? <Link href={pageHref(page - 1, courseId, lectureId)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}><ChevronLeft className="size-4" />{t("adaptPreviousPage")}</Link> : <span />}
        <p className="text-sm text-muted">{t("adaptQueuePage", { page, totalPages, total })}</p>
        {page < totalPages ? <Link href={pageHref(page + 1, courseId, lectureId)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("adaptNextPage")}<ChevronRight className="size-4" /></Link> : <span />}
      </nav>
    </section>
    <ConfirmDialog
      open={pendingDecision?.decision === "approve"}
      onOpenChange={(open) => { if (!open && !pending) setPendingDecision(null); }}
      title={t("adaptApproveConfirmTitle")}
      description={pendingDecision?.decision === "approve" ? t("adaptApproveConfirmDescription", { count: pendingDecision.ids.length }) : ""}
      confirmLabel={t("adaptApprove")}
      cancelLabel={t("adaptCancel")}
      onConfirm={confirmApprove}
      pending={pending}
    />
    <Dialog open={pendingDecision?.decision === "reject"} onOpenChange={(open) => { if (!open && !pending) setPendingDecision(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("adaptRejectConfirmTitle")}</DialogTitle>
          <DialogDescription>{pendingDecision?.decision === "reject" ? t("adaptRejectConfirmDescription", { count: pendingDecision.ids.length }) : ""}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-sm font-medium text-ink">{t("adaptRejectReasonLabel")}</p>
            <Select value={rejectReason} onValueChange={(value) => setRejectReason(value as AdaptRejectionCode)}>
              <SelectTrigger aria-label={t("adaptRejectReasonLabel")}><SelectValue placeholder={t("adaptRejectReasonPlaceholder")} /></SelectTrigger>
              <SelectContent>{ADAPT_REJECTION_CODES.map((code) => <SelectItem key={code} value={code}>{t(`adaptRejectReason_${code}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <p className="mb-1 text-sm font-medium text-ink">{t("adaptRejectNoteLabel")}</p>
            <Textarea value={rejectNote} maxLength={1000} onChange={(event) => setRejectNote(event.target.value)} placeholder={t("adaptRejectNotePlaceholder")} />
            <p className="mt-1 text-xs text-muted">{t("adaptRejectNoteHint")}</p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setPendingDecision(null)} disabled={pending}>{t("adaptCancel")}</Button>
          <Button type="button" variant="secondary" onClick={confirmReject} disabled={pending || !rejectReason || (rejectReason === "other" && !rejectNote.trim())}>{t("adaptReject")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
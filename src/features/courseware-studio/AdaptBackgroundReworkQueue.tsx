"use client";
/* eslint-disable @next/next/no-img-element -- private, short-lived signed CAS URLs cannot use next/image. */

import { DashboardEmptyCard } from "@/features/school/dashboard-page";
import { ChevronLeft, ChevronRight, Crop, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { stageCoursewareImageReplacementAction } from "./actions";
import { repairAdaptBackgroundAction } from "./adapt-actions";
import type { AdaptReworkQueue, AdaptReworkQueueItem } from "./adapt-review-data";

function pageHref(page: number, courseId: string | null, lectureId: string | null) {
  const query = new URLSearchParams({ tab: "rework", page: String(page) });
  if (courseId) query.set("course", courseId);
  if (lectureId) query.set("lecture", lectureId);
  return "/dashboard/courseware/review?" + query.toString();
}

function pageReviewHref(item: AdaptReworkQueueItem) {
  const query = new URLSearchParams({ tab: "pages", class: "all", course: item.courseId, lecture: item.lectureId });
  return "/dashboard/courseware/review?" + query.toString();
}

function cropGeometry(item: AdaptReworkQueueItem) {
  const sourceWidth = item.source.width ?? 0;
  const sourceHeight = item.source.height ?? 0;
  if (sourceWidth <= 0 || sourceHeight <= 0) return null;
  const cropWidth = Math.min(sourceWidth, Math.round(sourceHeight * 4 / 3));
  const cropHeight = Math.min(sourceHeight, Math.round(sourceWidth * 3 / 4));
  return {
    sourceWidth,
    sourceHeight,
    cropWidth,
    cropHeight,
    maxX: Math.max(0, sourceWidth - cropWidth),
    maxY: Math.max(0, sourceHeight - cropHeight),
  };
}

async function cropToFile(item: AdaptReworkQueueItem, cropX: number, cropY: number): Promise<File> {
  const geometry = cropGeometry(item);
  if (!geometry) throw new Error("ADAPT_REPAIR_RENDER_FAILED");
  const response = await fetch(item.source.url);
  if (!response.ok) throw new Error("ADAPT_REPAIR_RENDER_FAILED");
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  canvas.width = geometry.cropWidth;
  canvas.height = geometry.cropHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("ADAPT_REPAIR_RENDER_FAILED");
  context.drawImage(bitmap, cropX, cropY, geometry.cropWidth, geometry.cropHeight, 0, 0, geometry.cropWidth, geometry.cropHeight);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("ADAPT_REPAIR_RENDER_FAILED")), "image/png"));
  return new File([blob], `adapt-repair-${item.id}.png`, { type: "image/png" });
}

export function AdaptBackgroundReworkQueue({ items, page, total, totalPages, canManageAssets, courseId, lectureId }: AdaptReworkQueue & { canManageAssets: boolean; courseId: string | null; lectureId: string | null }) {
  const t = useTranslations("coursewareStudio");
  const router = useRouter();
  const [repairing, setRepairing] = useState<AdaptReworkQueueItem | null>(null);
  const [cropX, setCropX] = useState(0);
  const [cropY, setCropY] = useState(0);
  const [note, setNote] = useState("");
  const repairRun = useAction(
    async (item: AdaptReworkQueueItem, nextCropX: number, nextCropY: number, nextNote: string): Promise<ActionResult<{ adaptationId: string; affectedCount: number }>> => {
      try {
        const file = await cropToFile(item, nextCropX, nextCropY);
        const staged = await stageCoursewareImageReplacementAction({ file });
        if (!staged.ok) return { ok: false, code: staged.code };
        return repairAdaptBackgroundAction({ adaptationId: item.id, uploadId: staged.data.uploadId, cropX: nextCropX, cropY: nextCropY, note: nextNote });
      } catch {
        return { ok: false, code: "ADAPT_REPAIR_RENDER_FAILED" };
      }
    },
    {
      successMessage: t("adaptRepairSubmitted"),
      errorMessage: {
        ADAPT_BACKGROUND_NOT_REPAIRABLE: t("adaptRepairStale"),
        ADAPT_BACKGROUND_NOT_SELECTED: t("adaptRepairStale"),
        ADAPT_REPAIR_RENDER_FAILED: t("adaptRepairRenderFailed"),
        default: t("adaptRepairFailed"),
      },
      onSuccess: () => {
        setRepairing(null);
        router.refresh();
      },
    },
  );
  const openRepair = (item: AdaptReworkQueueItem) => {
    const geometry = cropGeometry(item);
    setCropX(Math.min(Math.max(item.cropX, 0), geometry?.maxX ?? 0));
    setCropY(Math.min(Math.max(item.cropY, 0), geometry?.maxY ?? 0));
    setNote("");
    setRepairing(item);
  };

  return <section className="min-w-0">
    <div className="rounded-2xl border border-line bg-card p-4">
      <h2 className="text-base font-medium text-ink">{t("adaptReworkQueueTitle")}</h2>
      <p className="mt-1 text-sm text-muted">{t("adaptReworkQueueIntro")}</p>
    </div>
    {items.length === 0 ? <DashboardEmptyCard className="mt-4">{t("adaptReworkQueueEmpty")}</DashboardEmptyCard> : <div className="mt-4 grid gap-4 xl:grid-cols-2">
      {items.map((item) => <article key={item.id} className="overflow-hidden rounded-2xl border border-line bg-card">
        <header className="border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium text-ink">{item.courseTitle}</p>
              <p className="mt-1 text-sm text-muted">{t("adaptReworkLecturePage", { lecture: item.lectureNo, name: item.lectureName, page: item.pageNo })}</p>
            </div>
            <Badge variant="secondary">{t(`adaptRejectReason_${item.rejectionCode}`)}</Badge>
          </div>
          {item.note ? <p className="mt-2 text-sm text-muted">{item.note}</p> : null}
        </header>
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <ReviewImage label={t("adaptSource")} image={item.source} aspect="aspect-video" />
          <ReviewImage label={t("adaptRejectedDerivative")} image={item.derived} aspect="aspect-[4/3]" />
        </div>
        <div className="border-t border-line px-4 py-3 text-xs text-muted">
          {t("adaptReworkUsage", { pages: item.pageCount, lectures: item.lectureCount, courses: item.courseCount })}
        </div>
        <footer className="flex flex-wrap gap-2 border-t border-line p-4">
          {canManageAssets ? <Button type="button" size="sm" onClick={() => openRepair(item)} disabled={!cropGeometry(item)}><Crop className="size-4" />{t("adaptRepairCrop")}</Button> : null}
          <Link href={`/studio/courseware/${item.lectureId}?track=adapted-4x3&page=${item.pageDocId}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("adaptVisualEdit")}<ExternalLink className="size-3" /></Link>
          <Link href={pageReviewHref(item)} className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("adaptChangeClassification")}</Link>
          <Link href={`/studio/courseware/${item.lectureId}?track=native-16x9&page=${item.pageDocId}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>{t("adaptUseNativeFallback")}</Link>
        </footer>
      </article>)}
    </div>}
    <nav className="mt-6 flex items-center justify-between gap-3" aria-label={t("adaptReworkPagination")}>
      {page > 1 ? <Link href={pageHref(page - 1, courseId, lectureId)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}><ChevronLeft className="size-4" />{t("adaptPreviousPage")}</Link> : <span />}
      <p className="text-sm text-muted">{t("adaptReworkPage", { page, totalPages, total })}</p>
      {page < totalPages ? <Link href={pageHref(page + 1, courseId, lectureId)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("adaptNextPage")}<ChevronRight className="size-4" /></Link> : <span />}
    </nav>
    <RepairDialog item={repairing} cropX={cropX} cropY={cropY} note={note} pending={repairRun.pending} setCropX={setCropX} setCropY={setCropY} setNote={setNote} close={() => setRepairing(null)} submit={() => { if (repairing) repairRun.run(repairing, cropX, cropY, note); }} />
  </section>;
}

function RepairDialog({ item, cropX, cropY, note, pending, setCropX, setCropY, setNote, close, submit }: { item: AdaptReworkQueueItem | null; cropX: number; cropY: number; note: string; pending: boolean; setCropX: (value: number) => void; setCropY: (value: number) => void; setNote: (value: string) => void; close: () => void; submit: () => void }) {
  const t = useTranslations("coursewareStudio");
  const geometry = item ? cropGeometry(item) : null;
  const previewStyle = geometry ? {
    width: `${geometry.sourceWidth / geometry.cropWidth * 100}%`,
    height: `${geometry.sourceHeight / geometry.cropHeight * 100}%`,
    left: `${-cropX / geometry.cropWidth * 100}%`,
    top: `${-cropY / geometry.cropHeight * 100}%`,
  } : undefined;
  return <Dialog open={item !== null} onOpenChange={(open) => { if (!open && !pending) close(); }}>
    <DialogContent className="max-h-[90dvh] max-w-4xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{t("adaptRepairDialogTitle")}</DialogTitle>
        <DialogDescription>{t("adaptRepairDialogDescription")}</DialogDescription>
      </DialogHeader>
      {item && geometry ? <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_18rem]">
        <div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-line bg-paper">
            <img src={item.source.url} alt={t("adaptRepairPreview")} className="absolute max-w-none object-fill" style={previewStyle} />
          </div>
          <p className="mt-2 text-xs text-muted">{t("adaptRepairOutput", { width: geometry.cropWidth, height: geometry.cropHeight })}</p>
        </div>
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex justify-between text-sm text-ink"><span>{t("adaptRepairCropX")}</span><span>{cropX}px</span></div>
            <Slider min={0} max={geometry.maxX} step={1} value={[cropX]} onValueChange={([value]) => setCropX(value ?? 0)} disabled={pending || geometry.maxX === 0} />
          </div>
          <div>
            <div className="mb-2 flex justify-between text-sm text-ink"><span>{t("adaptRepairCropY")}</span><span>{cropY}px</span></div>
            <Slider min={0} max={geometry.maxY} step={1} value={[cropY]} onValueChange={([value]) => setCropY(value ?? 0)} disabled={pending || geometry.maxY === 0} />
          </div>
          <div>
            <p className="mb-1 text-sm font-medium text-ink">{t("adaptRepairNote")}</p>
            <Textarea value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder={t("adaptRepairNotePlaceholder")} disabled={pending} />
          </div>
          <p className="text-xs text-muted">{t("adaptRepairAuditHint")}</p>
        </div>
      </div> : null}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close} disabled={pending}>{t("adaptCancel")}</Button>
        <Button type="button" onClick={submit} disabled={pending || !geometry}>{t("adaptRepairSubmit")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function ReviewImage({ label, image, aspect }: { label: string; image: AdaptReworkQueueItem["source"]; aspect: string }) {
  const t = useTranslations("coursewareStudio");
  return <figure className="rounded-xl border border-line p-2">
    <img src={image.url} alt={label} className={cn("w-full rounded-lg bg-paper object-contain", aspect)} />
    <figcaption className="mt-2 flex justify-between gap-2 text-xs text-muted"><span className="font-medium text-ink">{label}</span><span>{t("adaptDimensions", { width: image.width ?? "—", height: image.height ?? "—" })}</span></figcaption>
  </figure>;
}

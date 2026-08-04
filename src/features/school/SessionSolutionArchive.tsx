"use client";

import { Download, Eye, FileDown, FileText, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { createClient } from "@/lib/supabase/client";
import { recordSolutionRecordExportDownloadAction } from "./actions/exports";
import { cn } from "@/lib/utils";
import {
  SolutionRecordPreview,
  type SolutionRecordPagePreview,
} from "./CoursewareAnnotationBoard";
import type { PrepArtifactFile, PrepArtifactReview } from "./session-preparation-artifacts";
import { exportSolutionRecordWebp } from "./solution-record-export";
import { annotationContentSchema, type SolutionRecord } from "./teacher-preparation-contract";

function ReviewBadge({ review }: { review?: PrepArtifactReview }) {
  const t = useTranslations("school.session");
  if (!review) return <Badge variant="outline">{t("prepReviewNotSubmitted")}</Badge>;
  if (review.status === "approved") {
    return <Badge variant="secondary" className="border-leaf/50 bg-leaf/25 text-leaf-deep">{t("prepReviewApproved")}</Badge>;
  }
  if (review.status === "changes_requested") return <Badge variant="danger">{t("prepReviewChangesRequested")}</Badge>;
  return <Badge variant="secondary">{t("prepReviewPending")}</Badge>;
}

export function SolutionRecordExportButton({
  previewId,
  fileName,
  solutionRecordId,
  disabled = false,
}: {
  previewId: string;
  fileName: string;
  solutionRecordId: string;
  disabled?: boolean;
}) {
  const t = useTranslations("school.session");
  const [exporting, setExporting] = useState(false);
  const exportRecord = async () => {
    const target = document.getElementById(previewId);
    if (!target) {
      toast.error(t("solutionArchiveExportFailed"));
      return;
    }
    setExporting(true);
    try {
      await exportSolutionRecordWebp(target, fileName, async ({ artifactHash, sizeBytes }) => {
        const result = await recordSolutionRecordExportDownloadAction({
          solutionRecordId,
          artifactHash,
          sizeBytes,
        });
        if (!result.ok) throw new Error(result.code);
      });
    } catch {
      toast.error(t("solutionArchiveExportFailed"));
    } finally {
      setExporting(false);
    }
  };
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled={disabled || exporting}
      onClick={() => void exportRecord()}
    >
      {exporting
        ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" />
        : <FileDown size={14} />}
      {t("solutionArchiveExportWebp")}
    </Button>
  );
}


export function SessionSolutionArchive({
  sessionId,
  records,
  files,
  review,
  reviewerName,
  pageLabels,
  pagePreviews,
}: {
  sessionId: string;
  records: SolutionRecord[];
  files: PrepArtifactFile[];
  review?: PrepArtifactReview;
  reviewerName: string | null;
  pageLabels: Record<string, string>;
  pagePreviews: SolutionRecordPagePreview[];
}) {
  const t = useTranslations("school.session");
  const [open, setOpen] = useState(false);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const boardRecords = useMemo(() => records.flatMap((record) => {
    if (record.source !== "board") return [];
    const parsed = annotationContentSchema.safeParse(record.content.items ?? record.content.strokes);
    return parsed.success ? [{ ...record, items: parsed.data }] : [];
  }), [records]);
  const recordCount = boardRecords.length + files.length;

  const downloadUploadedFile = async (file: PrepArtifactFile) => {
    setDownloadingPath(file.path);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.storage.from("prep-artifacts").download(file.path);
      if (error) throw error;
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("solutionArchiveDownloadFailed"));
    } finally {
      setDownloadingPath(null);
    }
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="w-full"
        disabled={recordCount === 0}
        onClick={() => setOpen(true)}
        data-solution-archive-trigger
      >
        <Eye size={14} />
        {t("solutionArchiveOpen", { count: recordCount })}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[86dvh] flex-col sm:max-w-3xl" data-solution-record-archive>
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>{t("solutionArchiveTitle")}</DialogTitle>
              <ReviewBadge review={review} />
            </div>
            <DialogDescription>{t("solutionArchiveIntro")}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {review ? (
              <section className="rounded-xl border border-line bg-paper/55 p-3 text-xs text-muted" data-solution-review-state>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span>{t("prepReviewRevision", { revision: review.revision })}</span>
                  {reviewerName ? <span>{t("prepReviewerAssigned", { name: reviewerName })}</span> : null}
                  <span>{t("solutionArchiveSubmittedAt", { date: new Date(review.submittedAt).toLocaleString() })}</span>
                  {review.reviewedAt ? <span>{t("solutionArchiveReviewedAt", { date: new Date(review.reviewedAt).toLocaleString() })}</span> : null}
                </div>
                {review.reviewNote ? (
                  <p className={cn("mt-2 whitespace-pre-wrap rounded-lg p-2", review.status === "changes_requested" ? "bg-rose/10 text-rose" : "bg-line/35 text-ink")}>{review.reviewNote}</p>
                ) : null}
              </section>
            ) : null}

            {files.length > 0 ? (
              <section>
                <h3 className="text-sm font-medium text-ink">{t("solutionArchiveUploads")}</h3>
                <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-card">
                  {files.map((file) => (
                    <li key={file.path} className="flex min-h-11 items-center gap-2 px-3 text-xs">
                      <FileText size={14} className="shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate text-ink">{file.name}</span>
                      <Button type="button" size="sm" variant="ghost" disabled={downloadingPath !== null} onClick={() => void downloadUploadedFile(file)}>
                        {downloadingPath === file.path ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <Download size={14} />}
                        {t("solutionArchiveDownloadOriginal")}
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {boardRecords.length > 0 ? (
              <section>
                <h3 className="text-sm font-medium text-ink">{t("solutionArchiveBoards")}</h3>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {boardRecords.map((record) => {
                    const pageLabel = record.pageDocId ? pageLabels[record.pageDocId] : undefined;
                    const pagePreview = record.pageDocId
                      ? pagePreviews.find((item) => item.pageDocId === record.pageDocId) ?? null
                      : null;
                    const previewId = `solution-record-preview-${record.id}`;
                    return (
                      <article key={record.id} className="rounded-xl border border-line bg-card p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">{pageLabel ?? t("solutionArchiveUnknownPage")}</p>
                            <p className="text-xs text-muted">{t("prepReviewRevision", { revision: record.revision })}</p>
                          </div>
                          <SolutionRecordExportButton
                            previewId={previewId}
                            fileName={`solution-${sessionId}-${record.pageDocId ?? record.id}-r${record.revision}`}
                            solutionRecordId={record.id}
                            disabled={!pagePreview}
                          />
                        </div>
                        <SolutionRecordPreview
                          items={record.items}
                          label={t("annotationReviewPreview", { revision: record.revision })}
                          previewId={previewId}
                          pagePreview={pagePreview}
                          unavailableLabel={t("solutionArchivePageUnavailable")}
                        />
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

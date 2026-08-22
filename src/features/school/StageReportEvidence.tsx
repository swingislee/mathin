"use client";

import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Label } from "@/components/ui/label";
import type { StudentLearning } from "./students";

function inPeriod(value: string | null, start: string, end: string) {
  if (!value) return false;
  const day = value.slice(0, 10);
  return (!start || day >= start) && (!end || day <= end);
}

function average(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

function formatMetric(value: number | null) {
  return value === null ? "—" : Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function EvidenceSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium text-ink">{title}</h4>
        <Badge variant="outline">{count}</Badge>
      </div>
      {children}
    </section>
  );
}

export function StageReportEvidence({
  learning,
  periodStart,
  periodEnd,
  onPeriodStartChange,
  onPeriodEndChange,
  lockPeriod = false,
}: {
  learning: StudentLearning;
  periodStart: string;
  periodEnd: string;
  onPeriodStartChange: (value: string) => void;
  onPeriodEndChange: (value: string) => void;
  lockPeriod?: boolean;
}) {
  const t = useTranslations("school.learningResults");
  const locale = useLocale();
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const reviews = learning.reviews.filter((review) => inPeriod(review.scheduledAt, periodStart, periodEnd));
  const submissions = learning.submissions.filter((submission) => inPeriod(submission.gradedAt ?? submission.submittedAt, periodStart, periodEnd));
  const videos = learning.videos.filter((video) => inPeriod(video.reviewedAt ?? video.submittedAt, periodStart, periodEnd));
  const entryAverage = average(reviews.map((review) => review.entryScore));
  const exitAverage = average(reviews.map((review) => review.exitScore));
  const assignmentAverage = average(submissions.map((submission) => submission.score));
  const reviewedVideos = videos.filter((video) => video.reviewedAt).length;

  return (
    <aside className="min-w-0 rounded-2xl border border-line bg-paper/50 p-4 @3xl/page:p-5">
      <div>
        <h3 className="font-medium text-ink">{t("evidenceTitle")}</h3>
        <p className="mt-1 text-xs leading-5 text-muted">{t("evidenceHint")}</p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Label className="grid gap-1 text-xs text-muted">
          {t("periodStart")}
          <DateTimePicker value={periodStart} onValueChange={onPeriodStartChange} disabled={lockPeriod} />
        </Label>
        <Label className="grid gap-1 text-xs text-muted">
          {t("periodEnd")}
          <DateTimePicker value={periodEnd} onValueChange={onPeriodEndChange} disabled={lockPeriod} />
        </Label>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-xl bg-card px-3 py-3">
          <p className="text-xs text-muted">{t("evidenceReviewTrend")}</p>
          <p className="mt-1 text-lg font-medium tabular-nums text-ink">{formatMetric(entryAverage)} → {formatMetric(exitAverage)}</p>
          <p className="mt-1 text-[11px] text-muted">{t("evidenceRecords", { count: reviews.length })}</p>
        </div>
        <div className="rounded-xl bg-card px-3 py-3">
          <p className="text-xs text-muted">{t("evidenceAssignmentAverage")}</p>
          <p className="mt-1 text-lg font-medium tabular-nums text-ink">{formatMetric(assignmentAverage)}</p>
          <p className="mt-1 text-[11px] text-muted">{t("evidenceRecords", { count: submissions.length })}</p>
        </div>
        <div className="rounded-xl bg-card px-3 py-3">
          <p className="text-xs text-muted">{t("evidenceVideoCoverage")}</p>
          <p className="mt-1 text-lg font-medium tabular-nums text-ink">{reviewedVideos}/{videos.length}</p>
          <p className="mt-1 text-[11px] text-muted">{t("evidenceReviewed")}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <EvidenceSection title={t("evidenceReviews")} count={reviews.length}>
          {reviews.length === 0 ? <p className="mt-3 text-xs text-muted">{t("evidenceNoReviews")}</p> : (
            <ol className="mt-2 max-h-72 divide-y divide-line overflow-y-auto pr-1">
              {reviews.map((review) => (
                <li key={`${review.sessionId}-${review.scheduledAt}`} className="py-2 text-xs">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium text-ink">{review.lectureName || t("untitledSession")}</span>
                    <time className="shrink-0 text-muted">{date.format(new Date(review.scheduledAt))}</time>
                  </div>
                  <p className="mt-1 text-muted">{t("evidenceReviewScores", {
                    entry: review.entryScore ?? "—",
                    exit: review.exitScore ?? "—",
                    focus: review.focus ?? "—",
                    participation: review.participation ?? "—",
                    mastery: review.mastery ?? "—",
                  })}</p>
                  {review.comment && <p className="mt-1 whitespace-pre-wrap text-ink">{review.comment}</p>}
                </li>
              ))}
            </ol>
          )}
        </EvidenceSection>

        <EvidenceSection title={t("evidenceAssignments")} count={submissions.length}>
          {submissions.length === 0 ? <p className="mt-3 text-xs text-muted">{t("evidenceNoAssignments")}</p> : (
            <ol className="mt-2 max-h-64 divide-y divide-line overflow-y-auto pr-1">
              {submissions.map((submission) => {
                const eventAt = submission.gradedAt ?? submission.submittedAt;
                return (
                  <li key={submission.assignmentId} className="py-2 text-xs">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-medium text-ink">{submission.assignmentTitle || t("untitledAssignment")}</span>
                      <span className="shrink-0 text-muted">{submission.score === null ? t("ungraded") : t("evidenceScore", { score: submission.score })}</span>
                    </div>
                    {eventAt && <time className="mt-1 block text-muted">{date.format(new Date(eventAt))}</time>}
                    {submission.feedback && <p className="mt-1 whitespace-pre-wrap text-ink">{submission.feedback}</p>}
                  </li>
                );
              })}
            </ol>
          )}
        </EvidenceSection>

        <EvidenceSection title={t("evidenceVideos")} count={videos.length}>
          {videos.length === 0 ? <p className="mt-3 text-xs text-muted">{t("evidenceNoVideos")}</p> : (
            <ol className="mt-2 max-h-64 divide-y divide-line overflow-y-auto pr-1">
              {videos.map((video) => (
                <li key={video.id} className="py-2 text-xs">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium text-ink">{video.lectureName || t("untitledSession")}</span>
                    <span className="shrink-0 text-muted">{video.reviewedAt ? t("evidenceScore", { score: video.reviewScore ?? "—" }) : t("evidencePending")}</span>
                  </div>
                  <time className="mt-1 block text-muted">{date.format(new Date(video.reviewedAt ?? video.submittedAt))}</time>
                  {video.reviewComment && <p className="mt-1 whitespace-pre-wrap text-ink">{video.reviewComment}</p>}
                </li>
              ))}
            </ol>
          )}
        </EvidenceSection>
      </div>
    </aside>
  );
}

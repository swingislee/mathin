"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, CircleDashed, Star } from "lucide-react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { completeSessionTaskAction } from "./actions/classes";
import { addStudentFollowUp } from "./actions/followups";
import type { ReviewRecord } from "./review-actions";
import { saveSessionReviewsAction } from "./review-actions";
import { SessionTaskActions } from "./SessionPostworkActions";

export interface SessionStudentPostworkRow {
  studentId: string;
  displayName: string;
  attendanceStatus: "present" | "absent" | "late" | "leave" | null;
  stars: number;
  checks: Array<{
    id: string;
    title: string;
    status: "explained" | "independent" | "prompted" | "imitated" | "incomplete" | "unchecked";
  }>;
}

const CHECK_TONE: Record<SessionStudentPostworkRow["checks"][number]["status"], string> = {
  explained: "border-sky-400/40 bg-sky-100/70 text-sky-950 dark:bg-sky-950/40 dark:text-sky-100",
  independent: "border-leaf/40 bg-leaf/15 text-leaf-deep",
  prompted: "border-amber-400/40 bg-amber-100/70 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100",
  imitated: "border-violet-400/40 bg-violet-100/70 text-violet-950 dark:bg-violet-950/40 dark:text-violet-100",
  incomplete: "border-rose/40 bg-rose/10 text-rose",
  unchecked: "border-line bg-paper/50 text-muted",
};

export function SessionStudentPostworkCards({
  sessionId,
  rows,
  knowledgeSummary,
  initialReviews,
  canWriteReview,
  followupTask,
}: {
  sessionId: string;
  rows: SessionStudentPostworkRow[];
  knowledgeSummary: string;
  initialReviews: ReviewRecord[];
  canWriteReview: boolean;
  followupTask: { id: string; status: "pending" | "done" | "skipped" } | null;
}) {
  const t = useTranslations("school.session");
  const reviewT = useTranslations("school.reviews");
  const reportT = useTranslations("classroom.report");
  const router = useRouter();
  const [reviews, setReviews] = useState(initialReviews);
  const [followups, setFollowups] = useState<Record<string, string>>({});

  const saveReviews = useAction(
    (records: ReviewRecord[]) => saveSessionReviewsAction(sessionId, knowledgeSummary, records),
    {
      successMessage: reviewT("saved"),
      errorMessage: { default: reviewT("failed") },
      onSuccess: () => router.refresh(),
    },
  );
  const recordFollowup = useAction(
    async (studentId: string, content: string) => {
      const saved = await addStudentFollowUp(studentId, {
        content,
        kind: "class",
        nextFollowUpAt: null,
        statusAfter: null,
      });
      if (!saved.ok) return saved;
      if (followupTask?.status === "pending") {
        return completeSessionTaskAction(followupTask.id, "done", "");
      }
      return saved;
    },
    {
      successMessage: t("followupRecorded"),
      errorMessage: { default: t("actionFailed") },
      onSuccess: () => {
        setFollowups({});
        router.refresh();
      },
    },
  );

  const reviewByStudent = new Map(reviews.map((review) => [review.studentId, review]));
  const updateComment = (studentId: string, comment: string) => {
    setReviews((current) => current.map((review) => review.studentId === studentId ? { ...review, comment } : review));
  };

  if (rows.length === 0) {
    return <p className="mt-4 text-sm text-muted">{reportT("noStudents")}</p>;
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {followupTask?.status === "pending" && (
          <SessionTaskActions
            taskId={followupTask.id}
            disabled={false}
            hideMarkDone
            skipLabel={t("followupSkip")}
          />
        )}
        {canWriteReview && (
          <Button size="sm" disabled={saveReviews.pending} onClick={() => saveReviews.run(reviews)}>
            {t("saveStudentReviews")}
          </Button>
        )}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {rows.map((row) => {
          const review = reviewByStudent.get(row.studentId);
          const followup = followups[row.studentId] ?? "";
          return (
            <article key={row.studentId} className="min-w-0 rounded-xl border border-line bg-card p-3">
              <div className="flex min-w-0 items-center gap-2">
                <h4 className="min-w-0 flex-1 truncate font-medium text-ink">{row.displayName}</h4>
                <Badge variant="outline">
                  {row.attendanceStatus ? reportT("attendance_" + row.attendanceStatus) : reportT("notCaptured")}
                </Badge>
                <Badge variant="secondary" className="gap-1">
                  <Star size={12} aria-hidden="true" />
                  {row.stars}
                </Badge>
              </div>

              {row.checks.length > 0 && (
                <ul className="mt-3 grid max-h-28 grid-cols-1 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
                  {row.checks.map((check, index) => (
                    <li
                      key={check.id}
                      title={check.title}
                      className={cn("flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px]", CHECK_TONE[check.status])}
                    >
                      {check.status === "unchecked"
                        ? <CircleDashed size={12} className="shrink-0" aria-hidden="true" />
                        : <CheckCircle2 size={12} className="shrink-0" aria-hidden="true" />}
                      <span className="shrink-0 tabular-nums">{index + 1}.</span>
                      <span className="min-w-0 flex-1 truncate">{check.title}</span>
                      <span className="shrink-0">{t("learningStatus_" + check.status)}</span>
                    </li>
                  ))}
                </ul>
              )}

              {canWriteReview && review && (
                <Label className="mt-3 grid gap-1 text-xs font-normal text-muted">
                  {t("studentReviewInputLabel")}
                  <Input
                    value={review.comment}
                    onChange={(event) => updateComment(row.studentId, event.target.value)}
                    placeholder={t("studentReviewInputPlaceholder")}
                    maxLength={2000}
                  />
                </Label>
              )}

              {followupTask && (
                <div className="mt-2 grid gap-1 text-xs font-normal text-muted">
                  <span>{t("taskKind_followup")}</span>
                  <span className="flex min-w-0 gap-2">
                    <Input
                      value={followup}
                      onChange={(event) => setFollowups((current) => ({ ...current, [row.studentId]: event.target.value }))}
                      placeholder={t("followupContentPlaceholder")}
                      maxLength={2000}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      className="shrink-0"
                      disabled={!followup.trim() || recordFollowup.pending}
                      onClick={() => recordFollowup.run(row.studentId, followup)}
                    >
                      {t("followupSubmit")}
                    </Button>
                  </span>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}

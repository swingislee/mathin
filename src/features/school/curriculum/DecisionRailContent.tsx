"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import {
  approveCoursewareReviewAction,
  publishCoursewareReviewCycleAction,
  rejectCoursewareReviewAction,
  submitCoursewareReviewAction,
  withdrawCoursewareReviewAction,
} from "@/features/courseware-studio/actions";
import type { LectureReviewCapabilities } from "@/features/school/teaching-operations/types";
import type { CoursewareTrackState, ReviewCycleHistoryItem } from "./types";
import { EmergencyPublishDialog } from "./EmergencyPublishDialog";
import { lectureStageLabelKey } from "./stage-label";

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

export function DecisionRailContent({
  lectureId,
  trackState,
  capabilities,
  emergencyPublishEnabled,
  history,
}: {
  lectureId: string;
  trackState: CoursewareTrackState;
  capabilities: LectureReviewCapabilities;
  emergencyPublishEnabled: boolean;
  history: ReviewCycleHistoryItem[];
}) {
  const t = useTranslations("school.lecture");
  const router = useRouter();
  const [submitNote, setSubmitNote] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [publishNote, setPublishNote] = useState("");

  const errorMessages = { default: t("actionFailed"), FORBIDDEN_SELF_REVIEW: t("forbiddenSelfReview"), REVIEW_NOTE_REQUIRED: t("reviewNoteRequired") };

  const submitRun = useAction(submitCoursewareReviewAction, {
    successMessage: t("submitSuccess"),
    errorMessage: errorMessages,
    onSuccess: () => { setSubmitNote(""); router.refresh(); },
  });
  const withdrawRun = useAction(withdrawCoursewareReviewAction, {
    successMessage: t("withdrawSuccess"),
    errorMessage: errorMessages,
    onSuccess: () => router.refresh(),
  });
  const approveRun = useAction(approveCoursewareReviewAction, {
    successMessage: t("approveSuccess"),
    errorMessage: errorMessages,
    onSuccess: () => { setReviewNote(""); router.refresh(); },
  });
  const rejectRun = useAction(rejectCoursewareReviewAction, {
    successMessage: t("rejectSuccess"),
    errorMessage: errorMessages,
    onSuccess: () => { setReviewNote(""); router.refresh(); },
  });
  const publishRun = useAction(publishCoursewareReviewCycleAction, {
    successMessage: t("publishSuccess"),
    errorMessage: errorMessages,
    onSuccess: () => { setPublishNote(""); router.refresh(); },
  });

  const pending = submitRun.pending || withdrawRun.pending || approveRun.pending || rejectRun.pending || publishRun.pending;
  const trackHistory = history.filter((row) => row.track === trackState.track);
  const overdue = Boolean(trackState.internalDueAt && new Date(trackState.internalDueAt) < new Date());

  return <div className="flex flex-col gap-4 text-sm">
    <div>
      <p className="text-xs text-muted">{t("currentStage")}</p>
      <p className="mt-1 font-medium text-ink">{(() => { const { key, params } = lectureStageLabelKey(trackState); return t(key, params); })()}</p>
      {trackState.internalDueAt && <p className={`mt-1 text-xs ${overdue ? "text-rose" : "text-muted"}`}>{t("dueAt", { date: formatDateTime(trackState.internalDueAt) })}</p>}
      {trackState.activeReviewCycle && <p className="mt-1 text-xs text-muted">{t("submittedBy", { name: trackState.activeReviewCycle.creatorName })}</p>}
      {trackState.activeReviewCycle?.submissionNote && <p className="mt-1 rounded-lg bg-paper p-2 text-xs text-ink">{trackState.activeReviewCycle.submissionNote}</p>}
    </div>

    {capabilities.canSubmit && <div>
      <Textarea value={submitNote} onChange={(event) => setSubmitNote(event.target.value)} placeholder={t("submissionNotePlaceholder")} rows={2} className="text-xs" />
      <Button size="sm" className="mt-2 w-full" disabled={pending} onClick={() => submitRun.run(lectureId, trackState.track, submitNote)}>{t("submitForReview")}</Button>
    </div>}

    {capabilities.canWithdraw && trackState.activeReviewCycle && (
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => withdrawRun.run(trackState.activeReviewCycle!.id)}>{t("withdraw")}</Button>
    )}

    {(capabilities.canApprove || capabilities.canReject) && trackState.activeReviewCycle && <div>
      <Textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder={t("reviewNotePlaceholder")} rows={2} className="text-xs" />
      <div className="mt-2 flex gap-2">
        {capabilities.canApprove && <Button size="sm" className="flex-1" disabled={pending} onClick={() => approveRun.run(trackState.activeReviewCycle!.id, reviewNote)}>{t("approve")}</Button>}
        {capabilities.canReject && <Button size="sm" variant="secondary" className="flex-1" disabled={pending} onClick={() => { if (reviewNote.trim()) rejectRun.run(trackState.activeReviewCycle!.id, reviewNote); }}>{t("reject")}</Button>}
      </div>
    </div>}

    {capabilities.canPublishNow && <div>
      <Textarea value={publishNote} onChange={(event) => setPublishNote(event.target.value)} placeholder={t("publishNotePlaceholder")} rows={2} className="text-xs" />
      <Button size="sm" className="mt-2 w-full" disabled={pending} onClick={() => publishRun.run(lectureId, trackState.track, publishNote)}>{t("publishRelease")}</Button>
    </div>}

    {capabilities.canEmergencyPublishNow && emergencyPublishEnabled && (
      <EmergencyPublishDialog lectureId={lectureId} track={trackState.track} />
    )}

    <Separator />

    <div>
      <p className="text-xs font-medium text-ink">{t("history")}</p>
      {trackHistory.length === 0 ? <p className="mt-2 text-xs text-muted">{t("historyEmpty")}</p> : (
        <ul className="mt-2 flex flex-col gap-2">
          {trackHistory.map((row) => <li key={row.id} className="rounded-lg border border-line p-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <Badge variant={row.status === "passed" || row.status === "published" ? "secondary" : row.status === "changes_requested" ? "danger" : "outline"}>{t(`historyStatus_${row.status}`)}</Badge>
              <span className="text-muted">{formatDateTime(row.submittedAt)}</span>
            </div>
            <p className="mt-1.5 text-muted">{t("historyRound", { round: row.reviewRoundNo })} · {row.creatorName}{row.reviewerName ? ` → ${row.reviewerName}` : ""}{row.selfReview ? ` (${t("selfReview")})` : ""}</p>
            {row.reviewNote && <p className="mt-1 rounded bg-paper p-1.5 text-ink">{row.reviewNote}</p>}
          </li>)}
        </ul>
      )}
    </div>
  </div>;
}

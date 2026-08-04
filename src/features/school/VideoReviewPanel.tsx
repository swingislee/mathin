"use client";

import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { LearningResultWithdrawButton } from "./LearningResultWithdrawButton";
import { publishSessionVideoReviewAction } from "./learning-result-actions";
import { deleteSessionVideoAction, getVideoSignedUrl, reviewVideoAction } from "./video-actions";
import type { VideoRow } from "./videos";
import { fromSelectValue, toSelectValue } from "./controls";

export function VideoReviewPanel({ rows, canDelete = false }: { rows: VideoRow[]; canDelete?: boolean }) {
  const t = useTranslations("school.videos");
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [comment, setComment] = useState("");
  const [score, setScore] = useState("");
  const [loadingUrl, startLoadingUrl] = useTransition();
  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const saveReview = useAction(reviewVideoAction, {
    successMessage: t("reviewSavedToast"),
    errorMessage: { default: t("reviewActionFailed") },
    onSuccess: () => router.refresh(),
  });
  const publishReview = useAction(
    async (videoId: string, nextComment: string, nextScore: number) => {
      const saved = await reviewVideoAction(videoId, nextComment, nextScore);
      if (!saved.ok) return saved;
      return publishSessionVideoReviewAction(videoId);
    },
    {
      successMessage: t("reviewPublishedToast"),
      errorMessage: { default: t("reviewActionFailed") },
      onSuccess: () => router.refresh(),
    },
  );
  const deleteVideo = useAction(deleteSessionVideoAction, {
    successMessage: t("deletedToast"),
    errorMessage: { default: t("reviewActionFailed") },
    onSuccess: () => {
      setSelectedId(null);
      setUrl("");
      router.refresh();
    },
  });

  const pending = loadingUrl || saveReview.pending || publishReview.pending || deleteVideo.pending;
  const open = (row: VideoRow) => startLoadingUrl(async () => {
    setSelectedId(row.id);
    setComment(row.reviewComment);
    setScore(row.reviewScore?.toString() ?? "");
    setUrl("");
    try {
      setUrl(await getVideoSignedUrl(row.id));
    } catch {
      toast.error(t("playbackFailed"));
    }
  });
  const numericScore = Number(score);

  return (
    <div className="grid gap-6 @4xl/page:grid-cols-[1fr_1.3fr]">
      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="text-base font-medium text-ink">{t("queue")}</h2>
        <ul className="mt-3 divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} className="py-3">
              <button onClick={() => open(row)} className="flex w-full items-start justify-between gap-3 text-left">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{row.studentName}</span>
                  <span className="mt-1 block truncate text-xs text-muted">{row.classroomName} · {row.lectureName}</span>
                </span>
                <Badge variant={row.resultStatus === "published" ? "default" : "outline"}>
                  {t(`resultStatus_${row.resultStatus ?? "draft"}`)}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-line bg-card p-5">
        {loadingUrl && !url ? (
          <LoaderCircle className="animate-spin" />
        ) : selected && url ? (
          <>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-medium text-ink">{selected.studentName}</h3>
                <p className="text-xs text-muted">{selected.lectureName}</p>
              </div>
              <Badge variant={selected.resultStatus === "published" ? "default" : "outline"}>
                {t(`resultStatus_${selected.resultStatus ?? "draft"}`)}
              </Badge>
            </div>
            <video ref={video} src={url} controls className="w-full rounded-lg bg-black" />
            <div className="mt-3 flex flex-wrap gap-2">
              {[0.5, 1, 1.5, 2, 3].map((rate) => (
                <Button key={rate} size="sm" variant="secondary" onClick={() => {
                  if (video.current) video.current.playbackRate = rate;
                }}>
                  {rate}×
                </Button>
              ))}
              <Button size="sm" variant="secondary" onClick={() => {
                if (video.current) video.current.currentTime -= 10;
              }}>-10s</Button>
              <Button size="sm" variant="secondary" onClick={() => {
                if (video.current) video.current.currentTime += 10;
              }}>+10s</Button>
            </div>
            <Textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder={t("comment")}
              className="mt-3"
              maxLength={2000}
            />
            <Select value={toSelectValue(score)} onValueChange={(value) => setScore(fromSelectValue(value))}>
              <SelectTrigger className="mt-3"><SelectValue placeholder={t("score")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={toSelectValue("")}>{t("score")}</SelectItem>
                {[1, 2, 3, 4, 5].map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {selected.resultStatus === "published" && selected.resultHeadId && (
                <LearningResultWithdrawButton mode="head" targetId={selected.resultHeadId} disabled={pending} />
              )}
              {canDelete && (
                <Button
                  className="text-rose"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => deleteVideo.run(selected.id)}
                >
                  {t("delete")}
                </Button>
              )}
              <Button
                variant="secondary"
                disabled={pending || !score}
                onClick={() => saveReview.run(selected.id, comment, numericScore)}
              >
                {t("saveReviewDraft")}
              </Button>
              <Button
                disabled={pending || !score}
                onClick={() => publishReview.run(selected.id, comment, numericScore)}
              >
                {selected.resultStatus === "published" || selected.resultStatus === "revised" || selected.resultStatus === "withdrawn"
                  ? t("republishReview")
                  : t("publishReview")}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">{t("select")}</p>
        )}
      </section>
    </div>
  );
}

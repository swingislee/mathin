"use client";

import {
  CheckCircle2,
  CircleDashed,
  FileText,
  Link2,
  LoaderCircle,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { compressHomeworkImage } from "@/lib/media/compress-image";
import { createClient } from "@/lib/supabase/client";
import { newId } from "@/lib/uuid";
import { saveSessionPreparationArtifactsAction } from "./actions/classes";
import type {
  PrepArtifactFile,
  PrepArtifactKind,
  PrepArtifactReview,
  SessionPreparationArtifacts,
} from "./session-preparation-artifacts";

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const ACCEPT = "image/*,application/pdf,.doc,.docx";

function extension(file: File): string {
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "application/pdf") return "pdf";
  return file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "bin";
}

function ReviewStatus({ review, present }: { review?: PrepArtifactReview; present: boolean }) {
  const t = useTranslations("school.session");
  if (!present) return <Badge variant="outline">{t("prepReviewNotSubmitted")}</Badge>;
  if (!review) return <Badge variant="secondary">{t("prepReviewSubmitting")}</Badge>;
  if (review.status === "approved") {
    return <Badge variant="secondary" className="border-leaf/50 bg-leaf/25 text-leaf-deep">{t("prepReviewApproved")}</Badge>;
  }
  if (review.status === "changes_requested") return <Badge variant="danger">{t("prepReviewChangesRequested")}</Badge>;
  return <Badge variant="secondary">{t("prepReviewPending")}</Badge>;
}

export function SessionPreparationFlow({
  sessionId,
  initial,
}: {
  sessionId: string;
  initial: SessionPreparationArtifacts;
}) {
  const t = useTranslations("school.session");
  const router = useRouter();
  const [solutionNotes, setSolutionNotes] = useState(initial.solutionNotes);
  const [solutionFiles, setSolutionFiles] = useState(initial.solutionFiles);
  const [lessonPlanFiles, setLessonPlanFiles] = useState(initial.lessonPlanFiles);
  const [rehearsalVideoUrl, setRehearsalVideoUrl] = useState(initial.rehearsalVideoUrl);
  const [reviews, setReviews] = useState(initial.reviews);
  const [uploadingKind, setUploadingKind] = useState<"solution" | "lesson-plan" | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const solutionInput = useRef<HTMLInputElement>(null);
  const lessonPlanInput = useRef<HTMLInputElement>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveRevision = useRef(0);
  const latest = useRef({ solutionNotes, solutionFiles, lessonPlanFiles, rehearsalVideoUrl });
  useEffect(() => {
    latest.current = { solutionNotes, solutionFiles, lessonPlanFiles, rehearsalVideoUrl };
  }, [lessonPlanFiles, rehearsalVideoUrl, solutionFiles, solutionNotes]);

  const persist = (
    next: { solutionNotes: string; solutionFiles: PrepArtifactFile[]; lessonPlanFiles: PrepArtifactFile[]; rehearsalVideoUrl: string },
    changedKind?: PrepArtifactKind,
  ) => {
    latest.current = next;
    const revision = ++saveRevision.current;
    setSaveState("saving");
    if (changedKind) {
      setReviews((current) => ({
        ...current,
        [changedKind]: {
          kind: changedKind,
          status: "pending",
          revision: (current[changedKind]?.revision ?? 0) + 1,
          submittedAt: new Date().toISOString(),
          reviewedAt: null,
          reviewNote: "",
        },
      }));
    }
    saveQueue.current = saveQueue.current.then(async () => {
      const result = await saveSessionPreparationArtifactsAction({ sessionId, ...next });
      if (!result.ok) {
        if (saveRevision.current === revision) {
          setSaveState("error");
          setReviews(initial.reviews);
          toast.error(t("actionFailed"));
          router.refresh();
        }
        return;
      }
      if (saveRevision.current === revision) {
        setSaveState("saved");
        router.refresh();
      }
    }).catch(() => {
      if (saveRevision.current === revision) {
        setSaveState("error");
        setReviews(initial.reviews);
        toast.error(t("actionFailed"));
        router.refresh();
      }
    });
  };

  useEffect(() => {
    if (solutionNotes === initial.solutionNotes) return;
    const timer = window.setTimeout(() => {
      const shouldResubmit = solutionFiles.length > 0 && reviews.solution?.status !== "pending";
      persist({ ...latest.current, solutionNotes }, shouldResubmit ? "solution" : undefined);
    }, 900);
    return () => window.clearTimeout(timer);
    // Only text edits schedule this save; file mutations save immediately below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solutionNotes]);

  const upload = async (kind: "solution" | "lesson-plan", list: FileList | null) => {
    if (!list?.length) return;
    const current = kind === "solution" ? solutionFiles : lessonPlanFiles;
    const sources = Array.from(list).slice(0, Math.max(0, 10 - current.length));
    setUploadingKind(kind);
    const added: PrepArtifactFile[] = [];
    try {
      const supabase = createClient();
      for (const source of sources) {
        const file = await compressHomeworkImage(source);
        if (file.size > MAX_FILE_BYTES) throw new Error("FILE_TOO_LARGE");
        const path = `${sessionId}/${kind}/${newId()}.${extension(file)}`;
        const { error } = await supabase.storage.from("prep-artifacts").upload(path, file, {
          cacheControl: "3600",
          contentType: file.type || undefined,
          upsert: false,
        });
        if (error) throw error;
        added.push({ path, name: file.name, size: file.size, type: file.type });
      }
      const next = kind === "solution"
        ? { ...latest.current, solutionFiles: [...solutionFiles, ...added] }
        : { ...latest.current, lessonPlanFiles: [...lessonPlanFiles, ...added] };
      if (kind === "solution") setSolutionFiles(next.solutionFiles);
      else setLessonPlanFiles(next.lessonPlanFiles);
      persist(next, kind === "solution" ? "solution" : "lesson_plan");
      toast.success(t("prepArtifactsUploadedForReview", { count: added.length }));
    } catch {
      toast.error(t("prepArtifactsUploadFailed"));
    } finally {
      setUploadingKind(null);
      if (kind === "solution" && solutionInput.current) solutionInput.current.value = "";
      if (kind === "lesson-plan" && lessonPlanInput.current) lessonPlanInput.current.value = "";
    }
  };

  const remove = async (kind: "solution" | "lesson-plan", file: PrepArtifactFile) => {
    const supabase = createClient();
    const { error } = await supabase.storage.from("prep-artifacts").remove([file.path]);
    if (error) { toast.error(t("actionFailed")); return; }
    const next = kind === "solution"
      ? { ...latest.current, solutionFiles: solutionFiles.filter((item) => item.path !== file.path) }
      : { ...latest.current, lessonPlanFiles: lessonPlanFiles.filter((item) => item.path !== file.path) };
    if (kind === "solution") setSolutionFiles(next.solutionFiles);
    else setLessonPlanFiles(next.lessonPlanFiles);
    persist(next, kind === "solution" && next.solutionFiles.length > 0
      ? "solution"
      : kind === "lesson-plan" && next.lessonPlanFiles.length > 0 ? "lesson_plan" : undefined);
  };

  const fileList = (kind: "solution" | "lesson-plan", files: PrepArtifactFile[]) => files.length > 0 && (
    <ul className="mt-2 max-h-24 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-card/60">
      {files.map((file) => (
        <li key={file.path} className="flex min-h-9 items-center gap-2 px-2 text-xs">
          <FileText size={13} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <Button type="button" size="sm" variant="ghost" className="size-8 p-0" onClick={() => void remove(kind, file)} aria-label={t("removePrepArtifact")}>
            <Trash2 size={13} />
          </Button>
        </li>
      ))}
    </ul>
  );

  const saveLabel = saveState === "saving" ? t("prepAutoSaving") : saveState === "error" ? t("prepAutoSaveFailed") : t("prepAutoSaved");

  return (
    <div className="mt-4 space-y-4">
      <article data-notification-target="prep-solution" tabIndex={-1} className="rounded-xl border border-line bg-card/70 p-3 outline-none transition">
        <header className="flex items-start gap-2">
          {reviews.solution?.status === "approved" ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-leaf-deep" /> : <CircleDashed size={18} className="mt-0.5 shrink-0 text-muted" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">1. {t("prepFlowStudyTitle")}</p>
            <p className="mt-0.5 text-xs leading-5 text-muted">{t("prepFlowStudyBody")}</p>
          </div>
          <ReviewStatus review={reviews.solution} present={solutionFiles.length > 0} />
        </header>
        <Textarea className="mt-2 min-h-20 text-xs" value={solutionNotes} onChange={(event) => setSolutionNotes(event.target.value)} maxLength={5000} rows={3} placeholder={t("solutionRecordPlaceholder")} />
        <Input ref={solutionInput} className="hidden" type="file" accept={ACCEPT} multiple onChange={(event) => void upload("solution", event.target.files)} />
        <Button type="button" size="sm" variant="secondary" className="mt-2 w-full" disabled={uploadingKind !== null} onClick={() => solutionInput.current?.click()}>
          {uploadingKind === "solution" ? <LoaderCircle size={14} className="animate-spin" /> : <UploadCloud size={14} />}
          {t("uploadSolutionRecord")}
        </Button>
        {fileList("solution", solutionFiles)}
        {reviews.solution?.status === "changes_requested" && reviews.solution.reviewNote ? <p className="mt-2 text-xs text-rose">{reviews.solution.reviewNote}</p> : null}
      </article>

      <article data-notification-target="prep-lesson_plan" tabIndex={-1} className="rounded-xl border border-line bg-card/70 p-3 outline-none transition">
        <header className="flex items-start gap-2">
          {reviews.lesson_plan?.status === "approved" ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-leaf-deep" /> : <CircleDashed size={18} className="mt-0.5 shrink-0 text-muted" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">2. {t("prepFlowDesignTitle")}</p>
            <p className="mt-0.5 text-xs leading-5 text-muted">{t("standardLessonPlanHint")}</p>
          </div>
          <ReviewStatus review={reviews.lesson_plan} present={lessonPlanFiles.length > 0} />
        </header>
        <Input ref={lessonPlanInput} className="hidden" type="file" accept={ACCEPT} multiple onChange={(event) => void upload("lesson-plan", event.target.files)} />
        <Button type="button" size="sm" variant="secondary" className="mt-2 w-full" disabled={uploadingKind !== null} onClick={() => lessonPlanInput.current?.click()}>
          {uploadingKind === "lesson-plan" ? <LoaderCircle size={14} className="animate-spin" /> : <UploadCloud size={14} />}
          {t("uploadStandardLessonPlan")}
        </Button>
        {fileList("lesson-plan", lessonPlanFiles)}
        {reviews.lesson_plan?.status === "changes_requested" && reviews.lesson_plan.reviewNote ? <p className="mt-2 text-xs text-rose">{reviews.lesson_plan.reviewNote}</p> : null}
      </article>

      <article data-notification-target="prep-rehearsal_video" tabIndex={-1} className="rounded-xl border border-line bg-card/70 p-3 outline-none transition">
        <header className="flex items-start gap-2">
          {reviews.rehearsal_video?.status === "approved" ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-leaf-deep" /> : <CircleDashed size={18} className="mt-0.5 shrink-0 text-muted" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">3. {t("prepFlowRehearseTitle")}</p>
            <p className="mt-0.5 text-xs leading-5 text-muted">{t("prepFlowRehearseBody")}</p>
          </div>
          <ReviewStatus review={reviews.rehearsal_video} present={Boolean(rehearsalVideoUrl)} />
        </header>
        <label className="mt-2 grid gap-1 text-xs text-muted">
          <span className="flex items-center gap-1"><Link2 size={13} />{t("rehearsalVideoLinkTitle")}</span>
          <Input
            type="url"
            value={rehearsalVideoUrl}
            onChange={(event) => setRehearsalVideoUrl(event.target.value)}
            onBlur={() => {
              const value = rehearsalVideoUrl.trim();
              if (value && !value.startsWith("https://")) { toast.error(t("invalidRehearsalVideoLink")); return; }
              const changed = value !== initial.rehearsalVideoUrl;
              persist({ ...latest.current, rehearsalVideoUrl: value }, value && changed ? "rehearsal_video" : undefined);
            }}
            maxLength={1000}
            placeholder="https://pan.baidu.com/..."
          />
        </label>
        {reviews.rehearsal_video?.status === "changes_requested" && reviews.rehearsal_video.reviewNote ? <p className="mt-2 text-xs text-rose">{reviews.rehearsal_video.reviewNote}</p> : null}
      </article>

      <p className={`flex items-center gap-1 text-xs ${saveState === "error" ? "text-rose" : "text-muted"}`} aria-live="polite">
        {saveState === "saving" ? <LoaderCircle size={12} className="animate-spin" /> : null}{saveLabel}
      </p>
    </div>
  );
}

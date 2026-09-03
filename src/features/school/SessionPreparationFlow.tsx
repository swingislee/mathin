"use client";

import {
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Clock3,
  FileText,
  Link2,
  LockKeyhole,
  LoaderCircle,
  Trash2,
  UploadCloud,
  UserRoundCheck,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { compressHomeworkImage } from "@/lib/media/compress-image";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { newId } from "@/lib/uuid";
import { saveSessionPreparationArtifactsAction } from "./actions/classes";
import { setSessionPreparationReviewerAction } from "./teacher-preparation-actions";
import type { SolutionRecordPagePreview } from "./CoursewareAnnotationBoard";
import { SessionSolutionArchive } from "./SessionSolutionArchive";
import { PreparationReviewActions } from "./PreparationReviewActions";
import type { SolutionRecord } from "./teacher-preparation-contract";
import type {
  PrepArtifactFile,
  PrepArtifactKind,
  PrepArtifactReview,
  SessionPreparationArtifacts,
} from "./session-preparation-artifacts";

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const ACCEPT = "image/*,application/pdf,.doc,.docx";
type PrepStage = "study" | "design" | "rehearsal";

function extension(file: File): string {
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "application/pdf") return "pdf";
  return file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "bin";
}

function PrepStageTrigger({
  value,
  label,
  review,
}: {
  value: PrepStage;
  label: string;
  review?: PrepArtifactReview;
}) {
  const t = useTranslations("school.session");
  const completed = review?.status === "approved";
  const stateLabel = completed ? t("prepFlowCompletedShort")
    : review?.status === "pending" ? t("prepReviewPending")
      : review?.status === "changes_requested" ? t("prepReviewChangesRequested")
        : t("prepFlowIncompleteShort");
  const stateIcon = completed
    ? <CheckCircle2 size={15} className="text-leaf-deep" aria-hidden />
    : review?.status === "pending"
      ? <Clock3 size={15} className="text-amber-600 dark:text-amber-400" aria-hidden />
      : review?.status === "changes_requested"
        ? <CircleAlert size={15} className="text-rose" aria-hidden />
        : <CircleDashed size={15} className="text-muted" aria-hidden />;
  return (
    <TabsTrigger
      value={value}
      title={label + " · " + stateLabel}
      data-prep-stage-complete={completed ? "true" : "false"}
      className={cn(
        "min-w-0 gap-1 border border-transparent px-1.5 py-2 text-[11px] leading-tight",
        completed && "border-leaf/50 bg-leaf/20 text-leaf-deep data-[state=active]:bg-leaf/30 data-[state=active]:text-leaf-deep",
        review?.status === "changes_requested" && "border-rose/35",
      )}
    >
      <span className="shrink-0" data-prep-stage-status-icon>{stateIcon}</span>
      <span className="truncate font-medium">{label}</span>
      <span className="sr-only">{stateLabel}</span>
    </TabsTrigger>
  );
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
  solutionRecords,
  solutionPageLabels,
  solutionPagePreviews,
  lessonPlanEditor,
  initialStage = "study",
  readOnly = false,
  reviewerReadOnly = readOnly,
  canReview = false,
}: {
  sessionId: string;
  initial: SessionPreparationArtifacts;
  solutionRecords: SolutionRecord[];
  solutionPageLabels: Record<string, string>;
  solutionPagePreviews: SolutionRecordPagePreview[];
  lessonPlanEditor: ReactNode;
  initialStage?: PrepStage;
  readOnly?: boolean;
  reviewerReadOnly?: boolean;
  canReview?: boolean;
}) {
  const t = useTranslations("school.session");
  const router = useRouter();
  const [activeStage, setActiveStage] = useState<PrepStage>(initialStage);
  const [lessonPlanMounted, setLessonPlanMounted] = useState(initialStage === "design");
  const [solutionNotes, setSolutionNotes] = useState(initial.solutionNotes);
  const [solutionFiles, setSolutionFiles] = useState(initial.solutionFiles);
  const [lessonPlanFiles, setLessonPlanFiles] = useState(initial.lessonPlanFiles);
  const [rehearsalVideoUrl, setRehearsalVideoUrl] = useState(initial.rehearsalVideoUrl);
  const [reviews, setReviews] = useState(initial.reviews);
  const [reviewerId, setReviewerId] = useState(initial.reviewerId);
  const [reviewerSaving, setReviewerSaving] = useState(false);
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

  const changeStage = (next: string) => {
    if (next !== "study" && next !== "design" && next !== "rehearsal") return;
    if (next === "design") setLessonPlanMounted(true);
    setActiveStage(next);
  };

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
    if (readOnly || solutionNotes === initial.solutionNotes) return;
    const timer = window.setTimeout(() => {
      const shouldResubmit = solutionFiles.length > 0 && reviews.solution?.status !== "pending";
      persist({ ...latest.current, solutionNotes }, shouldResubmit ? "solution" : undefined);
    }, 900);
    return () => window.clearTimeout(timer);
    // Only text edits schedule this save; file mutations save immediately below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, solutionNotes]);

  const upload = async (kind: "solution" | "lesson-plan", list: FileList | null) => {
    if (readOnly || !list?.length) return;
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
    if (readOnly) return;
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

  const chooseReviewer = async (nextReviewerId: string) => {
    if (reviewerReadOnly || reviewerSaving || nextReviewerId === reviewerId) return;
    const previousReviewerId = reviewerId;
    setReviewerId(nextReviewerId);
    setReviewerSaving(true);
    const result = await setSessionPreparationReviewerAction({ sessionId, reviewerId: nextReviewerId });
    setReviewerSaving(false);
    if (!result.ok) {
      setReviewerId(previousReviewerId);
      toast.error(t("prepReviewerSaveFailed"));
      return;
    }
    toast.success(t("prepReviewerSaved"));
    router.refresh();
  };

  const fileList = (kind: "solution" | "lesson-plan", files: PrepArtifactFile[]) => files.length > 0 && (
    <ul className="mt-2 max-h-24 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-card/60">
      {files.map((file) => (
        <li key={file.path} className="flex min-h-9 items-center gap-2 px-2 text-xs">
          <FileText size={13} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          {!readOnly ? (
            <Button type="button" size="sm" variant="ghost" className="size-8 p-0" onClick={() => void remove(kind, file)} aria-label={t("removePrepArtifact")}>
              <Trash2 size={13} />
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );

  const saveLabel = saveState === "saving" ? t("prepAutoSaving") : saveState === "error" ? t("prepAutoSaveFailed") : t("prepAutoSaved");
  const reviewerLocked = initial.reviewerAssignmentSource === "supervisor_assigned";
  const selectedReviewerName = initial.reviewerCandidates.find((candidate) => candidate.userId === reviewerId)?.displayName
    ?? (reviewerId === initial.reviewerId ? initial.reviewerName : null);
  const reviewerHint = reviewerLocked ? t("prepReviewerSupervisorHint") : t("prepReviewerPhaseOneHint");

  return (
    <Tabs
      value={activeStage}
      onValueChange={changeStage}
      className="flex min-h-0 flex-1 flex-col"
      data-prep-flow-switcher
      data-active-stage={activeStage}
    >
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_7.75rem] gap-1 rounded-xl bg-line/40 p-1">
        <TabsList className="grid h-auto grid-cols-3 gap-1 bg-transparent p-0" aria-label={t("prepFlowTitle")}>
          <PrepStageTrigger value="study" label={t("prepFlowStudyShort")} review={reviews.solution} />
          <PrepStageTrigger value="design" label={t("prepFlowDesignShort")} review={reviews.lesson_plan} />
          <PrepStageTrigger value="rehearsal" label={t("prepFlowRehearseShort")} review={reviews.rehearsal_video} />
        </TabsList>
        <div className="min-w-0" data-preparation-reviewer-selector>
          <Select
            value={reviewerId ?? undefined}
            onValueChange={(value) => void chooseReviewer(value)}
            disabled={reviewerReadOnly || reviewerLocked || reviewerSaving}
          >
            <SelectTrigger
              className="h-full min-h-9 gap-1 border-transparent bg-card/80 px-2 text-[11px] shadow-none focus:ring-1"
              aria-label={t("prepReviewerTitle")}
              title={t("prepReviewerTitle") + "：" + (selectedReviewerName ?? t("prepReviewerPlaceholder")) + "。" + reviewerHint}
            >
              {reviewerSaving
                ? <LoaderCircle size={14} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
                : reviewerLocked
                  ? <LockKeyhole size={14} className="shrink-0 text-muted" aria-hidden />
                  : <UserRoundCheck size={14} className="shrink-0 text-muted" aria-hidden />}
              <span className="min-w-0 flex-1 truncate text-left">
                {selectedReviewerName ?? t("prepReviewerPlaceholder")}
              </span>
            </SelectTrigger>
            <SelectContent>
              {initial.reviewerCandidates.map((candidate) => (
                <SelectItem key={candidate.userId} value={candidate.userId}>
                  {candidate.displayName}{candidate.isSelf ? " · " + t("prepReviewerSelf") : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <TabsContent value="study" className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        <article data-notification-target="prep-solution" tabIndex={-1} className="rounded-xl border border-line bg-card/70 p-3 outline-none transition">
          <header className="flex items-start gap-2">
            {reviews.solution?.status === "approved" ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-leaf-deep" /> : <CircleDashed size={18} className="mt-0.5 shrink-0 text-muted" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">1. {t("prepFlowStudyTitle")}</p>
              <p className="mt-0.5 text-xs leading-5 text-muted">{t("prepFlowStudyBody")}</p>
            </div>
            <ReviewStatus review={reviews.solution} present={solutionFiles.length > 0 || solutionRecords.length > 0} />
          </header>
          <Textarea className="mt-2 min-h-24 text-xs" value={solutionNotes} readOnly={readOnly} onChange={(event) => setSolutionNotes(event.target.value)} maxLength={5000} rows={4} placeholder={t("solutionRecordPlaceholder")} />
          {!readOnly ? (
            <>
              <Input ref={solutionInput} className="hidden" type="file" accept={ACCEPT} multiple onChange={(event) => void upload("solution", event.target.files)} />
              <Button type="button" size="sm" variant="secondary" className="mt-2 w-full" disabled={uploadingKind !== null} onClick={() => solutionInput.current?.click()}>
                {uploadingKind === "solution" ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <UploadCloud size={14} />}
                {t("uploadSolutionRecord")}
              </Button>
            </>
          ) : null}
          {fileList("solution", solutionFiles)}
          <div className="mt-2">
            <SessionSolutionArchive
              sessionId={sessionId}
              records={solutionRecords}
              files={solutionFiles}
              review={reviews.solution}
              reviewerName={selectedReviewerName}
              pageLabels={solutionPageLabels}
              pagePreviews={solutionPagePreviews}
            />
          </div>
          {canReview && reviews.solution?.status === "pending"
            ? <PreparationReviewActions sessionId={sessionId} artifactKind="solution" />
            : null}
          {reviews.solution?.status === "changes_requested" && reviews.solution.reviewNote ? <p className="mt-2 text-xs text-rose">{reviews.solution.reviewNote}</p> : null}
        </article>
      </TabsContent>

      {lessonPlanMounted ? (
        <TabsContent forceMount value="design" className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1 data-[state=inactive]:hidden">
          <div className="flex min-h-full flex-col gap-3">
            <article data-notification-target="prep-lesson_plan" tabIndex={-1} className="shrink-0 rounded-xl border border-line bg-card/70 p-2 outline-none transition">
              <div className="flex min-w-0 items-center gap-2">
                {reviews.lesson_plan?.status === "approved" ? <CheckCircle2 size={16} className="shrink-0 text-leaf-deep" /> : <FileText size={16} className="shrink-0 text-muted" />}
                <div className="min-w-0 flex-1" title={t("standardLessonPlanHint")}>
                  <p className="truncate text-xs font-medium text-ink">{t("lessonPlanAttachmentTitle")}</p>
                  <p className="truncate text-[10px] text-muted">{t("lessonPlanAttachmentHint")}</p>
                </div>
                {!readOnly ? (
                  <>
                    <Input ref={lessonPlanInput} className="hidden" type="file" accept={ACCEPT} multiple onChange={(event) => void upload("lesson-plan", event.target.files)} />
                    <Button type="button" size="sm" variant="secondary" className="h-8 shrink-0 px-2 text-xs" disabled={uploadingKind !== null} onClick={() => lessonPlanInput.current?.click()}>
                      {uploadingKind === "lesson-plan" ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <UploadCloud size={14} />}
                      {t("uploadLessonPlanShort")}
                    </Button>
                  </>
                ) : null}
              </div>
              {fileList("lesson-plan", lessonPlanFiles)}
              {reviews.lesson_plan?.status === "changes_requested" && reviews.lesson_plan.reviewNote ? <p className="mt-2 text-xs text-rose">{reviews.lesson_plan.reviewNote}</p> : null}
            </article>
            <div className="min-h-[36rem] flex-1">{lessonPlanEditor}</div>
            {canReview && reviews.lesson_plan?.status === "pending"
              ? <PreparationReviewActions sessionId={sessionId} artifactKind="lesson_plan" />
              : null}
          </div>
        </TabsContent>
      ) : null}

      <TabsContent value="rehearsal" className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        <article data-notification-target="prep-rehearsal_video" tabIndex={-1} className="rounded-xl border border-line bg-card/70 p-3 outline-none transition">
          <header className="flex items-start gap-2">
            {reviews.rehearsal_video?.status === "approved" ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-leaf-deep" /> : <CircleDashed size={18} className="mt-0.5 shrink-0 text-muted" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">3. {t("prepFlowRehearseTitle")}</p>
              <p className="mt-0.5 text-xs leading-5 text-muted">{t("prepFlowRehearseBody")}</p>
            </div>
            <ReviewStatus review={reviews.rehearsal_video} present={Boolean(rehearsalVideoUrl)} />
          </header>
          <div className="mt-3 grid gap-1 text-xs text-muted">
            <span className="flex items-center gap-1"><Link2 size={13} />{t("rehearsalVideoLinkTitle")}</span>
            <span className="flex min-w-0 gap-2">
              <Input
                aria-label={t("rehearsalVideoLinkTitle")}
                type="url"
                value={rehearsalVideoUrl}
                readOnly={readOnly}
                onChange={(event) => setRehearsalVideoUrl(event.target.value)}
                onBlur={() => {
                  if (readOnly) return;
                  const value = rehearsalVideoUrl.trim();
                  if (value && !value.startsWith("https://")) { toast.error(t("invalidRehearsalVideoLink")); return; }
                  const changed = value !== initial.rehearsalVideoUrl;
                  persist({ ...latest.current, rehearsalVideoUrl: value }, value && changed ? "rehearsal_video" : undefined);
                }}
                maxLength={1000}
                placeholder="https://pan.baidu.com/..."
              />
              {!readOnly && rehearsalVideoUrl ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="shrink-0 text-rose"
                  onClick={() => {
                    setRehearsalVideoUrl("");
                    persist({ ...latest.current, rehearsalVideoUrl: "" });
                  }}
                >
                  <Trash2 size={13} />
                  {t("removeRehearsalVideoLink")}
                </Button>
              ) : null}
            </span>
          </div>
          {canReview && reviews.rehearsal_video?.status === "pending"
            ? <PreparationReviewActions sessionId={sessionId} artifactKind="rehearsal_video" />
            : null}
          {reviews.rehearsal_video?.status === "changes_requested" && reviews.rehearsal_video.reviewNote ? <p className="mt-2 text-xs text-rose">{reviews.rehearsal_video.reviewNote}</p> : null}
        </article>
      </TabsContent>

      <p className={`mt-2 flex shrink-0 items-center gap-1 text-xs ${saveState === "error" ? "text-rose" : "text-muted"}`} aria-live="polite">
        {!readOnly && saveState === "saving" ? <LoaderCircle size={12} className="animate-spin motion-reduce:animate-none" /> : null}
        {readOnly ? t("prepArchiveReadOnly") : saveLabel}
      </p>
    </Tabs>
  );
}

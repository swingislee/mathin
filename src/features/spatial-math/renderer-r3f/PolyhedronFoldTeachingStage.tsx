"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Camera, Check, ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type {
  SpatialCommandActor,
  SpatialCommandPayload,
  SpatialPageDoc,
  SpatialRuntimeState,
} from "../domain";
import {
  createPolyhedronFaceAttemptDraft,
  createPolyhedronTeachingCommandIntent,
  derivePolyhedronTeachingControllerView,
  nextPolyhedronFaceSelection,
  type PolyhedronFaceAttemptDraft,
  type PolyhedronTeachingAction,
  type PolyhedronTeachingLocale,
} from "../runtime";
import { PolyhedronFoldView } from "./PolyhedronFoldView";
import type { PolyhedronFoldRendererMessages } from "./PolyhedronFoldCanvas";

const MINIMUM_PLAYBACK_STEP_MS = 650;
const EMPTY_FACE_SELECTION: readonly string[] = [];

export interface PolyhedronFoldTeachingMessages extends PolyhedronFoldRendererMessages {
  readonly previousStep: string;
  readonly nextStep: string;
  readonly playSteps: string;
  readonly pauseSteps: string;
  readonly resetScene: string;
  readonly foldProgress: string;
  readonly cameraBookmarks: string;
  readonly submitChoice: string;
  readonly teacherFollow: string;
  readonly studentLocalExplore: string;
  readonly studentSubmit: string;
  readonly formatStepPosition: (current: number, total: number) => string;
  readonly formatProgress: (percent: number) => string;
}

export interface PolyhedronFoldTeachingStageProps {
  readonly page: SpatialPageDoc;
  readonly state: SpatialRuntimeState;
  readonly entityId: string;
  readonly actor: SpatialCommandActor;
  readonly locale: PolyhedronTeachingLocale;
  readonly messages: PolyhedronFoldTeachingMessages;
  readonly readOnly?: boolean;
  readonly selectedFaceIds?: readonly string[];
  readonly onSelectedFaceIdsChange?: (faceIds: readonly string[]) => void;
  readonly onCommandIntent: (payload: SpatialCommandPayload) => void;
  readonly onAttemptDraft?: (draft: PolyhedronFaceAttemptDraft) => void;
  readonly materialColors?: Readonly<Record<string, string>>;
  readonly controlsLayout?: "overlay" | "external";
  readonly className?: string;
}

export function PolyhedronFoldTeachingStage({
  page,
  state,
  entityId,
  actor,
  locale,
  messages,
  readOnly = false,
  selectedFaceIds = EMPTY_FACE_SELECTION,
  onSelectedFaceIdsChange,
  onCommandIntent,
  onAttemptDraft,
  materialColors,
  controlsLayout = "overlay",
  className,
}: PolyhedronFoldTeachingStageProps) {
  const view = useMemo(
    () => derivePolyhedronTeachingControllerView(page, state, entityId, actor, locale, readOnly),
    [actor, entityId, locale, page, readOnly, state],
  );
  const [playing, setPlaying] = useState(false);
  const summaryId = useId();
  const [previewProgress, setPreviewProgress] = useState<{ readonly value: number; readonly baseline: number } | null>(null);
  const previewStillCurrent =
    previewProgress !== null &&
    Math.abs(view.progress - previewProgress.baseline) <= 0.000_001;
  const visibleProgress = previewStillCurrent ? previewProgress.value : view.progress;
  const emit = useCallback(
    (action: PolyhedronTeachingAction) => {
      const payload = createPolyhedronTeachingCommandIntent(page, state, entityId, actor, action);
      if (payload) onCommandIntent(payload);
    },
    [actor, entityId, onCommandIntent, page, state],
  );
  const commitFoldProgress = (progress: number) => {
    setPreviewProgress(null);
    emit({ kind: "fold.set", progress });
  };

  const playbackActive = playing && view.canGoNext;
  useEffect(() => {
    if (!playbackActive) return;
    const delay = Math.max(view.activeStep?.durationMs ?? 0, MINIMUM_PLAYBACK_STEP_MS);
    const timer = window.setTimeout(() => {
      setPreviewProgress(null);
      emit({ kind: "step.next" });
      if (view.activeStep?.index === view.steps.length - 2) setPlaying(false);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [emit, playbackActive, view.activeStep?.durationMs, view.activeStep?.id, view.activeStep?.index, view.steps.length]);

  const ownershipLabel =
    view.ownershipMode === "teacher-follow"
      ? messages.teacherFollow
      : view.ownershipMode === "student-local-explore"
        ? messages.studentLocalExplore
        : messages.studentSubmit;
  const currentStepPosition = view.activeStep ? view.activeStep.index + 1 : 0;
  const selectableFaceIds = useMemo(
    () => view.faceCheckpoint?.options.map((option) => option.id) ?? EMPTY_FACE_SELECTION,
    [view.faceCheckpoint],
  );
  const selectableFaceIdSet = useMemo(() => new Set(selectableFaceIds), [selectableFaceIds]);
  const validSelectedFaceIds = useMemo(
    () => selectedFaceIds.filter((faceId) => selectableFaceIdSet.has(faceId)),
    [selectableFaceIdSet, selectedFaceIds],
  );
  const canChooseFaces = view.canSelectFaces && Boolean(onSelectedFaceIdsChange);

  const selectFace = (faceId: string) => {
    if (!canChooseFaces || !selectableFaceIdSet.has(faceId)) return;
    onSelectedFaceIdsChange?.(nextPolyhedronFaceSelection(view, selectedFaceIds, faceId));
  };
  const togglePlayback = () => {
    if (playbackActive) {
      setPlaying(false);
      return;
    }
    if (!view.canGoNext && view.steps[0]) emit({ kind: "step.go", stepId: view.steps[0].id });
    setPlaying(true);
  };
  const submitChoice = () => {
    if (!onAttemptDraft) return;
    onAttemptDraft(createPolyhedronFaceAttemptDraft(view, validSelectedFaceIds));
  };

  const externalControls = controlsLayout === "external";
  const visibleProgressPercent = Math.round(visibleProgress * 100);
  const committedProgressPercent = Math.round(view.progress * 100);
  const foldView = (
    <PolyhedronFoldView
      className="absolute inset-0 h-full aspect-auto rounded-none border-0 shadow-none"
      scene={page.scene}
      entityId={entityId}
      progress={visibleProgress}
      locale={locale}
      cameraId={view.cameraId}
      selectedFaceIds={validSelectedFaceIds}
      selectableFaceIds={selectableFaceIds}
      readOnly={!view.canManipulateScene}
      onFaceSelect={canChooseFaces ? selectFace : undefined}
      messages={messages}
      materialColors={materialColors}
      transition={
        previewStillCurrent
          ? { durationMs: 0, easing: "linear" }
          : view.activeStep
            ? { durationMs: view.activeStep.durationMs, easing: view.activeStep.easing }
            : undefined
      }
    />
  );
  const cameraButtons = view.cameras.map((camera) => (
    <Button
      key={camera.id}
      type="button"
      size="sm"
      variant="ghost"
      className={cn(
        externalControls ? "h-11 px-3 text-sm" : "h-7 px-2 text-xs",
        camera.id === view.cameraId && "bg-moon/70 text-ink",
      )}
      disabled={!view.canManipulateScene}
      aria-pressed={camera.id === view.cameraId}
      onClick={() => emit({ kind: "camera.apply", cameraId: camera.id })}
    >
      {camera.label}
    </Button>
  ));
  const checkpointControls = view.faceCheckpoint ? (
    <div>
      <p className="text-sm leading-5 text-ink">{view.faceCheckpoint.prompt}</p>
      <div className={cn("mt-2 flex flex-wrap", externalControls ? "gap-2" : "gap-1.5")} role="group" aria-label={view.faceCheckpoint.prompt}>
        {view.faceCheckpoint.options.map((option) => {
          const selected = validSelectedFaceIds.includes(option.id);
          return (
            <Button
              key={option.id}
              type="button"
              size="sm"
              variant="secondary"
              className={cn(
                externalControls ? "h-11 px-3 text-sm" : "h-7 px-2 text-xs",
                selected && "border-rose-deep bg-moon/70",
              )}
              disabled={!canChooseFaces}
              aria-pressed={selected}
              onClick={() => selectFace(option.id)}
            >
              {selected ? <Check aria-hidden="true" className="size-3.5" /> : null}
              {option.label}
            </Button>
          );
        })}
      </div>
      {view.canSubmitFaceChoice ? (
        <Button
          type="button"
          size="sm"
          className={cn("mt-3 w-full", externalControls && "h-11")}
          disabled={!onAttemptDraft || validSelectedFaceIds.length === 0}
          onClick={submitChoice}
        >
          {messages.submitChoice}
        </Button>
      ) : null}
    </div>
  ) : null;
  const previousButton = (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      className={cn(externalControls ? "size-11" : "size-8", "p-0")}
      aria-label={messages.previousStep}
      disabled={!view.canGoPrevious}
      onClick={() => {
        setPlaying(false);
        emit({ kind: "step.previous" });
      }}
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
    </Button>
  );
  const playbackButton = (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      className={cn(externalControls ? "size-11" : "size-8", "p-0")}
      aria-label={playbackActive ? messages.pauseSteps : messages.playSteps}
      disabled={!view.canManipulateScene || view.steps.length < 2}
      onClick={togglePlayback}
    >
      {playbackActive ? <Pause aria-hidden="true" className="size-4" /> : <Play aria-hidden="true" className="size-4" />}
    </Button>
  );
  const nextButton = (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      className={cn(externalControls ? "size-11" : "size-8", "p-0")}
      aria-label={messages.nextStep}
      disabled={!view.canGoNext}
      onClick={() => {
        setPlaying(false);
        emit({ kind: "step.next" });
      }}
    >
      <ChevronRight aria-hidden="true" className="size-4" />
    </Button>
  );
  const resetButton = view.canReset ? (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={cn(externalControls ? "size-11" : "size-8", "p-0")}
      aria-label={messages.resetScene}
      onClick={() => {
        setPlaying(false);
        setPreviewProgress(null);
        emit({ kind: "scene.reset" });
      }}
    >
      <RotateCcw aria-hidden="true" className="size-4" />
    </Button>
  ) : null;
  const progressSlider = (
    <Slider
      className={externalControls ? "h-11" : undefined}
      min={0}
      max={100}
      step={1}
      value={[visibleProgressPercent]}
      disabled={!view.canManipulateScene}
      aria-label={messages.foldProgress}
      aria-valuetext={messages.formatProgress(visibleProgressPercent)}
      onValueChange={(values) =>
        setPreviewProgress({ value: (values[0] ?? 0) / 100, baseline: view.progress })
      }
      onValueCommit={(values) => commitFoldProgress((values[0] ?? 0) / 100)}
    />
  );
  const accessibilityContent = (
    <div className="sr-only">
      <p id={summaryId}>{view.accessibilitySummary}</p>
      <ul>
        {view.faceLabels.map((face) => <li key={face.id}>{face.label}</li>)}
      </ul>
      <p role="status" aria-live="polite" aria-atomic="true">
        {view.activeStep?.label ?? view.entityLabel}. {view.activeStep?.announcement ?? ""} {messages.formatProgress(committedProgressPercent)}
      </p>
    </div>
  );

  if (externalControls) {
    return (
      <section
        className={cn("w-full space-y-3", className)}
        data-spatial-controller="polyhedron-teaching-controller-v1"
        data-controls-layout="external"
        aria-label={view.entityLabel}
        aria-describedby={summaryId}
      >
        <div
          className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-line bg-paper shadow-sm"
          data-layout-profile="standard-4x3"
        >
          {foldView}
        </div>
        <Card>
          <CardContent className="grid gap-4 p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{ownershipLabel}</Badge>
              <span className="text-sm text-muted">
                {messages.formatStepPosition(currentStepPosition, view.steps.length)}
              </span>
            </div>
            <div role="group" aria-label={messages.cameraBookmarks}>
              <p className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
                <Camera aria-hidden="true" className="size-4 text-muted" />
                {messages.cameraBookmarks}
              </p>
              <div className="flex flex-wrap gap-2">{cameraButtons}</div>
            </div>
            {checkpointControls}
            <div className="grid gap-3 border-t border-line pt-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium text-ink">{view.activeStep?.label ?? view.entityLabel}</span>
                <span className="shrink-0 tabular-nums text-muted">{messages.formatProgress(visibleProgressPercent)}</span>
              </div>
              {progressSlider}
              <div className="flex items-center gap-2">
                {previousButton}
                {playbackButton}
                {nextButton}
                <span className="flex-1" />
                {resetButton}
              </div>
              {view.activeStep?.teacherPrompt ? (
                <p className="text-sm leading-6 text-muted">{view.activeStep.teacherPrompt}</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
        {accessibilityContent}
      </section>
    );
  }

  return (
    <section
      className={cn(
        "relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-line bg-paper shadow-sm",
        className,
      )}
      data-layout-profile="standard-4x3"
      data-spatial-controller="polyhedron-teaching-controller-v1"
      data-controls-layout="overlay"
      aria-label={view.entityLabel}
      aria-describedby={summaryId}
    >
      {foldView}
      <header className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-start justify-between gap-3">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-full border border-line bg-card/95 px-2 py-1 shadow-sm backdrop-blur-sm">
          <Badge variant="secondary">{ownershipLabel}</Badge>
          <span className="truncate text-xs text-muted">
            {messages.formatStepPosition(currentStepPosition, view.steps.length)}
          </span>
        </div>
        <div
          className="pointer-events-auto flex max-w-[62%] flex-wrap justify-end gap-1 rounded-2xl border border-line bg-card/95 p-1.5 shadow-sm backdrop-blur-sm"
          role="group"
          aria-label={messages.cameraBookmarks}
        >
          <Camera aria-hidden="true" className="m-1 size-4 text-muted" />
          {cameraButtons}
        </div>
      </header>
      {checkpointControls ? (
        <aside className="absolute right-3 top-20 z-20 w-[min(15rem,38%)] rounded-2xl border border-line bg-card/95 p-3 shadow-sm backdrop-blur-sm">
          {checkpointControls}
        </aside>
      ) : null}
      <footer className="absolute inset-x-3 bottom-3 z-20 rounded-2xl border border-line bg-card/95 p-3 shadow-sm backdrop-blur-sm">
        <div className="flex items-center gap-2">
          {previousButton}
          {playbackButton}
          {nextButton}
          <div className="min-w-0 flex-1 px-2">
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="truncate font-medium text-ink">{view.activeStep?.label ?? view.entityLabel}</span>
              <span className="tabular-nums text-muted">{messages.formatProgress(visibleProgressPercent)}</span>
            </div>
            {progressSlider}
          </div>
          {resetButton}
        </div>
        {view.activeStep?.teacherPrompt ? (
          <p className="mt-2 truncate border-t border-line pt-2 text-xs text-muted">{view.activeStep.teacherPrompt}</p>
        ) : null}
      </footer>
      {accessibilityContent}
    </section>
  );
}

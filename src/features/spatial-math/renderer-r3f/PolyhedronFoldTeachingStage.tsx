"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, Check, ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  className,
}: PolyhedronFoldTeachingStageProps) {
  const view = useMemo(
    () => derivePolyhedronTeachingControllerView(page, state, entityId, actor, locale, readOnly),
    [actor, entityId, locale, page, readOnly, state],
  );
  const [playing, setPlaying] = useState(false);
  const [previewProgress, setPreviewProgress] = useState<{ readonly value: number; readonly baseline: number } | null>(null);
  const previewStillCurrent =
    previewProgress !== null &&
    (Math.abs(view.progress - previewProgress.baseline) <= 0.000_001 ||
      Math.abs(view.progress - previewProgress.value) <= 0.000_001);
  const visibleProgress = previewStillCurrent ? previewProgress.value : view.progress;
  const emit = useCallback(
    (action: PolyhedronTeachingAction) => {
      const payload = createPolyhedronTeachingCommandIntent(page, state, entityId, actor, action);
      if (payload) onCommandIntent(payload);
    },
    [actor, entityId, onCommandIntent, page, state],
  );

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
  const canChooseFaces = view.canSelectFaces && Boolean(onSelectedFaceIdsChange);

  const selectFace = (faceId: string) => {
    if (!canChooseFaces) return;
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
    onAttemptDraft(createPolyhedronFaceAttemptDraft(view, selectedFaceIds));
  };

  return (
    <section
      className={cn(
        "relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-line bg-paper shadow-sm",
        className,
      )}
      data-layout-profile="standard-4x3"
      data-spatial-controller="polyhedron-teaching-controller-v1"
      aria-label={view.entityLabel}
    >
      <PolyhedronFoldView
        className="absolute inset-0 h-full aspect-auto rounded-none border-0 shadow-none"
        scene={page.scene}
        entityId={entityId}
        progress={visibleProgress}
        locale={locale}
        cameraId={view.cameraId}
        selectedFaceIds={selectedFaceIds}
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

      <header className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-start justify-between gap-3">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-full border border-line bg-card/95 px-2 py-1 shadow-sm backdrop-blur-sm">
          <Badge variant="secondary">{ownershipLabel}</Badge>
          <span className="truncate text-xs text-muted">
            {messages.formatStepPosition(currentStepPosition, view.steps.length)}
          </span>
        </div>
        <div
          className="pointer-events-auto flex max-w-[62%] flex-wrap justify-end gap-1 rounded-2xl border border-line bg-card/95 p-1.5 shadow-sm backdrop-blur-sm"
          aria-label={messages.cameraBookmarks}
        >
          <Camera aria-hidden="true" className="m-1 size-4 text-muted" />
          {view.cameras.map((camera) => (
            <Button
              key={camera.id}
              type="button"
              size="sm"
              variant="ghost"
              className={cn("h-7 px-2 text-xs", camera.id === view.cameraId && "bg-moon/70 text-ink")}
              disabled={!view.canManipulateScene}
              aria-pressed={camera.id === view.cameraId}
              onClick={() => emit({ kind: "camera.apply", cameraId: camera.id })}
            >
              {camera.label}
            </Button>
          ))}
        </div>
      </header>

      {view.faceCheckpoint ? (
        <aside className="absolute right-3 top-20 z-20 w-[min(15rem,38%)] rounded-2xl border border-line bg-card/95 p-3 shadow-sm backdrop-blur-sm">
          <p className="text-sm leading-5 text-ink">{view.faceCheckpoint.prompt}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {view.faceCheckpoint.options.map((option) => {
              const selected = selectedFaceIds.includes(option.id);
              return (
                <Button
                  key={option.id}
                  type="button"
                  size="sm"
                  variant="secondary"
                  className={cn("h-7 px-2 text-xs", selected && "border-rose-deep bg-moon/70")}
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
              className="mt-3 w-full"
              disabled={!onAttemptDraft || selectedFaceIds.length === 0}
              onClick={submitChoice}
            >
              {messages.submitChoice}
            </Button>
          ) : null}
        </aside>
      ) : null}

      <footer className="absolute inset-x-3 bottom-3 z-20 rounded-2xl border border-line bg-card/95 p-3 shadow-sm backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="size-8 p-0"
            aria-label={messages.previousStep}
            disabled={!view.canGoPrevious}
            onClick={() => {
              setPlaying(false);
              emit({ kind: "step.previous" });
            }}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="size-8 p-0"
            aria-label={playbackActive ? messages.pauseSteps : messages.playSteps}
            disabled={!view.canManipulateScene || view.steps.length < 2}
            onClick={togglePlayback}
          >
            {playbackActive ? <Pause aria-hidden="true" className="size-4" /> : <Play aria-hidden="true" className="size-4" />}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="size-8 p-0"
            aria-label={messages.nextStep}
            disabled={!view.canGoNext}
            onClick={() => {
              setPlaying(false);
              emit({ kind: "step.next" });
            }}
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </Button>

          <div className="min-w-0 flex-1 px-2">
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="truncate font-medium text-ink">{view.activeStep?.label ?? view.entityLabel}</span>
              <span className="tabular-nums text-muted">{messages.formatProgress(Math.round(visibleProgress * 100))}</span>
            </div>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[Math.round(visibleProgress * 100)]}
              disabled={!view.canManipulateScene}
              aria-label={messages.foldProgress}
              onValueChange={(values) =>
                setPreviewProgress({ value: (values[0] ?? 0) / 100, baseline: view.progress })
              }
              onValueCommit={(values) => emit({ kind: "fold.set", progress: (values[0] ?? 0) / 100 })}
            />
          </div>

          {view.canReset ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="size-8 p-0"
              aria-label={messages.resetScene}
              onClick={() => {
                setPlaying(false);
                setPreviewProgress(null);
                emit({ kind: "scene.reset" });
              }}
            >
              <RotateCcw aria-hidden="true" className="size-4" />
            </Button>
          ) : null}
        </div>
        {view.activeStep?.teacherPrompt ? (
          <p className="mt-2 truncate border-t border-line pt-2 text-xs text-muted">{view.activeStep.teacherPrompt}</p>
        ) : null}
      </footer>
    </section>
  );
}

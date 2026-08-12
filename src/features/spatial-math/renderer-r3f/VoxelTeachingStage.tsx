"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, ChevronLeft, ChevronRight, Eye, EyeOff, Layers3, Magnet, Pause, Play, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  SpatialCommandActor,
  SpatialCommandPayload,
  SpatialPageDoc,
  SpatialRuntimeState,
  VoxelFaceSelection,
} from "../domain";
import {
  createVoxelCountAttemptDraft,
  createVoxelTeachingCommandIntent,
  deriveVoxelTeachingControllerView,
  type VoxelCountAttemptDraft,
  type VoxelTeachingAction,
  type VoxelTeachingLocale,
} from "../runtime";
import type { VoxelRendererMessages } from "./VoxelFallback";
import { VoxelView } from "./VoxelView";

const MINIMUM_PLAYBACK_STEP_MS = 650;

export interface VoxelTeachingMessages extends VoxelRendererMessages {
  readonly previousStep: string;
  readonly nextStep: string;
  readonly playSteps: string;
  readonly pauseSteps: string;
  readonly resetScene: string;
  readonly cameraBookmarks: string;
  readonly axisSnap: string;
  readonly enableAxisSnap: string;
  readonly disableAxisSnap: string;
  readonly layers: string;
  readonly countPlaceholder: string;
  readonly submitCount: string;
  readonly teacherFollow: string;
  readonly studentLocalExplore: string;
  readonly studentSubmit: string;
  readonly formatStepPosition: (current: number, total: number) => string;
  readonly formatLayerAction: (label: string, currentlyVisible: boolean) => string;
}

export interface VoxelTeachingStageProps {
  readonly page: SpatialPageDoc;
  readonly state: SpatialRuntimeState;
  readonly entityId: string;
  readonly actor: SpatialCommandActor;
  readonly locale: VoxelTeachingLocale;
  readonly messages: VoxelTeachingMessages;
  readonly readOnly?: boolean;
  readonly onCommandIntent: (payload: SpatialCommandPayload) => void;
  readonly onAttemptDraft?: (draft: VoxelCountAttemptDraft) => void;
  readonly materialColors?: Readonly<Record<string, string>>;
  readonly paintedFaces?: readonly VoxelFaceSelection[];
  readonly paintedFaceMaterialToken?: string;
  readonly onFaceSelect?: (face: VoxelFaceSelection) => void;
  readonly className?: string;
}

export function VoxelTeachingStage({
  page,
  state,
  entityId,
  actor,
  locale,
  messages,
  readOnly = false,
  onCommandIntent,
  onAttemptDraft,
  materialColors,
  paintedFaces,
  paintedFaceMaterialToken,
  onFaceSelect,
  className,
}: VoxelTeachingStageProps) {
  const view = useMemo(
    () => deriveVoxelTeachingControllerView(page, state, entityId, actor, locale, readOnly),
    [actor, entityId, locale, page, readOnly, state],
  );
  const [playing, setPlaying] = useState(false);
  const [countValue, setCountValue] = useState("");
  const [axisSnapEnabled, setAxisSnapEnabled] = useState(false);
  const emit = useCallback(
    (action: VoxelTeachingAction) => {
      const payload = createVoxelTeachingCommandIntent(page, state, entityId, actor, locale, action, readOnly);
      if (payload) onCommandIntent(payload);
    },
    [actor, entityId, locale, onCommandIntent, page, readOnly, state],
  );
  const playbackActive = playing && view.canGoNext;
  useEffect(() => {
    if (!playbackActive) return;
    const delay = Math.max(view.activeStep?.durationMs ?? 0, MINIMUM_PLAYBACK_STEP_MS);
    const timer = window.setTimeout(() => {
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
  const validCount = /^\d{1,9}$/.test(countValue.trim());
  const togglePlayback = () => {
    if (playbackActive) {
      setPlaying(false);
      return;
    }
    if (!view.canGoNext && view.steps[0]) emit({ kind: "step.go", stepId: view.steps[0].id });
    setPlaying(true);
  };

  return (
    <section
      className={cn("relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-line bg-paper shadow-sm", className)}
      data-layout-profile="standard-4x3"
      data-spatial-controller="voxel-teaching-controller-v1"
      aria-label={view.entityLabel}
    >
      <VoxelView
        className="absolute inset-0 h-full aspect-auto rounded-none border-0 shadow-none"
        page={page}
        state={state}
        entityId={entityId}
        locale={locale}
        readOnly={!view.canManipulateScene}
        axisSnapEnabled={axisSnapEnabled}
        messages={messages}
        materialColors={materialColors}
        paintedFaces={paintedFaces}
        paintedFaceMaterialToken={paintedFaceMaterialToken}
        onFaceSelect={onFaceSelect}
      />

      <header className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-start justify-between gap-3">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-full border border-line bg-card/95 px-2 py-1 shadow-sm backdrop-blur-sm">
          <Badge variant="secondary">{ownershipLabel}</Badge>
          <span className="truncate text-xs text-muted">
            {messages.formatStepPosition(currentStepPosition, view.steps.length)}
          </span>
          {view.totalCount !== null ? <Badge>{messages.formatTotalCount(view.totalCount)}</Badge> : null}
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
          <Button
            type="button"
            size="sm"
            variant={axisSnapEnabled ? "secondary" : "ghost"}
            className="h-7 gap-1 px-2 text-xs"
            disabled={!view.canManipulateScene}
            aria-label={axisSnapEnabled ? messages.disableAxisSnap : messages.enableAxisSnap}
            aria-pressed={axisSnapEnabled}
            onClick={() => setAxisSnapEnabled((current) => !current)}
          >
            <Magnet aria-hidden="true" className="size-3.5" />
            {messages.axisSnap}
          </Button>
        </div>
      </header>

      <aside className="absolute bottom-24 right-3 top-20 z-20 flex w-[min(16rem,38%)] flex-col overflow-hidden rounded-2xl border border-line bg-card/95 p-3 shadow-sm backdrop-blur-sm">
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          <Layers3 aria-hidden="true" className="size-4 text-muted" />
          {messages.layers}
        </div>
        <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-auto">
          {view.layers.map((layer) => (
            <Button
              key={layer.id}
              type="button"
              size="sm"
              variant="ghost"
              className={cn("h-auto w-full justify-start px-2 py-1.5 text-left text-xs", layer.visible && "bg-leaf/20")}
              disabled={!view.canManipulateScene}
              aria-label={messages.formatLayerAction(layer.label, layer.visible)}
              aria-pressed={layer.visible}
              onClick={() => emit({ kind: "layer.toggle", layerId: layer.id })}
            >
              {layer.visible ? <Eye aria-hidden="true" className="size-3.5 shrink-0" /> : <EyeOff aria-hidden="true" className="size-3.5 shrink-0" />}
              <span className="min-w-0 flex-1 truncate">{layer.label}</span>
              <span className="tabular-nums text-muted">{layer.count ?? messages.unrevealedCount}</span>
            </Button>
          ))}
        </div>
        {view.countCheckpoint ? (
          <div className="mt-2 border-t border-line pt-2">
            <p className="text-xs leading-5 text-ink">{view.countCheckpoint.prompt}</p>
            {view.canSubmitCount ? (
              <div className="mt-2 flex gap-2">
                <Input
                  value={countValue}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={messages.countPlaceholder}
                  className="h-8 min-w-0"
                  onChange={(event) => setCountValue(event.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={!onAttemptDraft || !validCount}
                  onClick={() => onAttemptDraft?.(createVoxelCountAttemptDraft(view, countValue))}
                >
                  {messages.submitCount}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </aside>

      <footer className="absolute inset-x-3 bottom-3 z-20 rounded-2xl border border-line bg-card/95 p-3 shadow-sm backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="secondary" className="size-8 p-0" aria-label={messages.previousStep} disabled={!view.canGoPrevious} onClick={() => { setPlaying(false); emit({ kind: "step.previous" }); }}>
            <ChevronLeft aria-hidden="true" className="size-4" />
          </Button>
          <Button type="button" size="sm" variant="secondary" className="size-8 p-0" aria-label={playbackActive ? messages.pauseSteps : messages.playSteps} disabled={!view.canManipulateScene || view.steps.length < 2} onClick={togglePlayback}>
            {playbackActive ? <Pause aria-hidden="true" className="size-4" /> : <Play aria-hidden="true" className="size-4" />}
          </Button>
          <Button type="button" size="sm" variant="secondary" className="size-8 p-0" aria-label={messages.nextStep} disabled={!view.canGoNext} onClick={() => { setPlaying(false); emit({ kind: "step.next" }); }}>
            <ChevronRight aria-hidden="true" className="size-4" />
          </Button>
          <div className="min-w-0 flex-1 px-2">
            <p className="truncate text-sm font-medium text-ink">{view.activeStep?.label ?? view.entityLabel}</p>
            {view.activeStep?.teacherPrompt ? <p className="truncate text-xs text-muted">{view.activeStep.teacherPrompt}</p> : null}
          </div>
          {view.canReset ? (
            <Button type="button" size="sm" variant="ghost" className="size-8 p-0" aria-label={messages.resetScene} onClick={() => { setPlaying(false); emit({ kind: "scene.reset" }); }}>
              <RotateCcw aria-hidden="true" className="size-4" />
            </Button>
          ) : null}
        </div>
      </footer>
    </section>
  );
}

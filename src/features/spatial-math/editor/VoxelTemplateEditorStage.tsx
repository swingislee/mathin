"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";
import { Box, Layers3, Redo2, RotateCcw, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  AXES,
  buildVoxelCountingPage,
  createInitialSpatialRuntimeState,
  type Axis,
  type SpatialPageDoc,
  type VoxelCoordinate,
  type VoxelSceneAdapterInput,
} from "../domain";
import { VoxelView } from "../renderer-r3f/VoxelView";
import type { VoxelRendererMessages } from "../renderer-r3f/VoxelFallback";
import {
  applyVoxelTemplateEditorAction,
  createVoxelTemplateEditorState,
  deriveVoxelTemplateEditorView,
  voxelTemplateEditorPreviewKey,
  type VoxelTemplateEditorAction,
  type VoxelTemplateEditorBounds,
  type VoxelTemplateEditorState,
} from "./voxel-template-editor";
import { assertVoxelEditorStandard4x3Page } from "./voxel-editor-page-contract";

export interface VoxelTemplateEditorMessages extends VoxelRendererMessages {
  readonly editorTitle: string;
  readonly editorDescription: string;
  readonly axisLabel: string;
  readonly layersLabel: string;
  readonly gridLabel: string;
  readonly previewLabel: string;
  readonly previewBuilding: string;
  readonly previewReady: string;
  readonly previewError: string;
  readonly undo: string;
  readonly redo: string;
  readonly resetDraft: string;
  readonly modified: string;
  readonly saved: string;
  readonly performanceWarning: string;
  readonly formatAxis: (axis: Axis) => string;
  readonly formatLayer: (coordinate: number, count: number) => string;
  readonly formatGridCell: (coordinate: VoxelCoordinate, occupied: boolean) => string;
  readonly formatCounts: (total: number, activeLayer: number) => string;
}

export interface VoxelTemplateEditorStageProps {
  readonly initialInput: VoxelSceneAdapterInput;
  readonly bounds?: VoxelTemplateEditorBounds;
  readonly editorState?: VoxelTemplateEditorState;
  readonly onEditorAction?: (action: VoxelTemplateEditorAction) => void;
  readonly pageBuilder?: VoxelTemplateEditorPageBuilder;
  readonly locale: "zh" | "en";
  readonly messages: VoxelTemplateEditorMessages;
  readonly onDraftChange?: (draft: VoxelSceneAdapterInput) => void;
  readonly onReadyPage?: (page: SpatialPageDoc) => void;
  readonly materialColors?: Readonly<Record<string, string>>;
  readonly className?: string;
}

export type VoxelTemplateEditorPageBuilder = (
  draft: VoxelSceneAdapterInput,
) => Promise<{ readonly page: SpatialPageDoc }>;

type PreviewState =
  | {
      readonly status: "building";
      readonly key: string;
      readonly builder: VoxelTemplateEditorPageBuilder;
    }
  | {
      readonly status: "ready";
      readonly key: string;
      readonly builder: VoxelTemplateEditorPageBuilder;
      readonly page: SpatialPageDoc;
      readonly runtime: ReturnType<typeof createInitialSpatialRuntimeState>;
    }
  | {
      readonly status: "error";
      readonly key: string;
      readonly builder: VoxelTemplateEditorPageBuilder;
    };

function localizedText(input: { readonly zh: string; readonly en?: string }, locale: "zh" | "en"): string {
  return locale === "en" ? input.en ?? input.zh : input.zh;
}

export function VoxelTemplateEditorStage({
  initialInput,
  bounds,
  editorState,
  onEditorAction,
  pageBuilder,
  locale,
  messages,
  onDraftChange,
  onReadyPage,
  materialColors,
  className,
}: VoxelTemplateEditorStageProps) {
  const [uncontrolledEditor, setUncontrolledEditor] = useState(() =>
    createVoxelTemplateEditorState(initialInput, bounds),
  );
  const editor = editorState ?? uncontrolledEditor;
  const view = useMemo(() => deriveVoxelTemplateEditorView(editor), [editor]);
  const draft = editor.draft;
  const buildPage = pageBuilder ?? buildVoxelCountingPage;
  const buildKey = useMemo(
    () => voxelTemplateEditorPreviewKey(draft, pageBuilder ? "injected" : "default"),
    [draft, pageBuilder],
  );
  const [preview, setPreview] = useState<PreviewState>(() => ({
    status: "building",
    key: buildKey,
    builder: buildPage,
  }));
  const previewIsCurrent = preview.key === buildKey && preview.builder === buildPage;
  const readyPreview = previewIsCurrent && preview.status === "ready" ? preview : null;
  const previewStatus = previewIsCurrent ? preview.status : "building";
  const completePreviewBuild = useEffectEvent((
    requestKey: string,
    requestBuilder: VoxelTemplateEditorPageBuilder,
    built: { readonly page: SpatialPageDoc } | null,
  ) => {
    if (requestKey !== buildKey || requestBuilder !== buildPage) return;
    if (!built) {
      setPreview({ status: "error", key: requestKey, builder: requestBuilder });
      return;
    }
    try {
      assertVoxelEditorStandard4x3Page(built.page);
    } catch {
      setPreview({ status: "error", key: requestKey, builder: requestBuilder });
      return;
    }
    const ready = {
      status: "ready" as const,
      key: requestKey,
      builder: requestBuilder,
      page: built.page,
      runtime: createInitialSpatialRuntimeState(built.page),
    };
    setPreview(ready);
    onReadyPage?.(built.page);
  });
  const apply = useCallback((action: VoxelTemplateEditorAction) => {
    if (editorState !== undefined) {
      onEditorAction?.(action);
      return;
    }
    setUncontrolledEditor((current) => applyVoxelTemplateEditorAction(current, action));
  }, [editorState, onEditorAction]);

  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

  useEffect(() => {
    let active = true;
    void buildPage(draft)
      .then((built) => {
        if (!active) return;
        completePreviewBuild(buildKey, buildPage, built);
      })
      .catch(() => {
        if (active) completePreviewBuild(buildKey, buildPage, null);
      });
    return () => {
      active = false;
    };
  }, [buildKey, buildPage, draft]);

  const title = localizedText(draft.title, locale);
  const learningGoal = localizedText(draft.learningGoal, locale);

  return (
    <section
      className={cn("space-y-4", className)}
      data-spatial-editor="voxel-template-editor-v1"
      data-layout-profile="standard-4x3"
      aria-label={messages.editorTitle}
    >
      <Card>
        <CardHeader className="gap-3 p-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Box aria-hidden="true" className="size-4 text-leaf-deep" />
              {messages.editorTitle}
            </CardTitle>
            <CardDescription>{messages.editorDescription}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">4:3</Badge>
            <Badge variant={view.isDirty ? "default" : "secondary"}>{view.isDirty ? messages.modified : messages.saved}</Badge>
            <Button type="button" size="sm" variant="ghost" className="size-8 p-0" aria-label={messages.undo} disabled={!view.canUndo} onClick={() => apply({ kind: "history.undo" })}>
              <Undo2 aria-hidden="true" className="size-4" />
            </Button>
            <Button type="button" size="sm" variant="ghost" className="size-8 p-0" aria-label={messages.redo} disabled={!view.canRedo} onClick={() => apply({ kind: "history.redo" })}>
              <Redo2 aria-hidden="true" className="size-4" />
            </Button>
            <Button type="button" size="sm" variant="secondary" aria-label={messages.resetDraft} disabled={!view.isDirty} onClick={() => apply({ kind: "draft.reset" })}>
              <RotateCcw aria-hidden="true" className="size-4" />
              {messages.resetDraft}
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid items-start gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="space-y-3 p-4">
            <div>
              <CardTitle className="truncate text-base">{title}</CardTitle>
              <CardDescription className="mt-1 line-clamp-2">{learningGoal}</CardDescription>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted">{messages.axisLabel}</p>
              <div className="grid grid-cols-3 gap-1">
                {AXES.map((axis) => (
                  <Button
                    key={axis}
                    type="button"
                    size="sm"
                    variant="secondary"
                    className={cn("h-8 px-2", view.layerAxis === axis && "bg-moon/70")}
                    aria-pressed={view.layerAxis === axis}
                    onClick={() => apply({ kind: "axis.select", axis })}
                  >
                    {messages.formatAxis(axis)}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-4 pt-0">
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-xs font-medium text-muted">
                  <Layers3 aria-hidden="true" className="size-4" />
                  {messages.layersLabel}
                </p>
                <Badge variant="outline">{messages.formatCounts(view.totalCount, view.activeLayerCount)}</Badge>
              </div>
              <div className="flex max-h-28 flex-wrap gap-1 overflow-auto" role="group" aria-label={messages.layersLabel}>
                {view.layers.map((layer) => (
                  <Button
                    key={layer.coordinate}
                    type="button"
                    size="sm"
                    variant="ghost"
                    className={cn("h-8 px-2 text-xs", layer.active && "bg-leaf/20 text-ink")}
                    aria-pressed={layer.active}
                    onClick={() => apply({ kind: "layer.select", coordinate: layer.coordinate })}
                  >
                    {messages.formatLayer(layer.coordinate, layer.count)}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-muted">{messages.gridLabel}</p>
              <div className="overflow-auto rounded-2xl border border-line bg-paper p-2">
                <div
                  className="grid min-w-max gap-1"
                  style={{ gridTemplateColumns: `repeat(${view.columns.length}, 2rem)` }}
                  role="grid"
                  aria-label={messages.gridLabel}
                >
                  {view.cells.map((cell) => {
                    const removingLast = cell.occupied && view.totalCount === 1;
                    return (
                      <Button
                        key={`${cell.u}:${cell.v}`}
                        type="button"
                        size="sm"
                        variant="secondary"
                        className={cn(
                          "size-8 rounded-lg p-0 text-[10px] tabular-nums",
                          cell.occupied ? "border-leaf-deep bg-leaf/60 text-ink" : "border-line text-muted hover:bg-moon/30",
                        )}
                        disabled={removingLast}
                        aria-pressed={cell.occupied}
                        aria-label={messages.formatGridCell(cell.coordinate, cell.occupied)}
                        onClick={() => apply({ kind: "cell.toggle", u: cell.u, v: cell.v })}
                      >
                        {cell.occupied ? view.activeLayer : ""}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>

            {view.performanceWarning ? (
              <p className="rounded-xl border border-moon bg-moon/20 p-2 text-xs leading-5 text-ink">{messages.performanceWarning}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between gap-3 p-4">
            <div>
              <CardTitle className="text-base">{messages.previewLabel}</CardTitle>
              <CardDescription>
                {previewStatus === "ready"
                  ? messages.previewReady
                  : previewStatus === "error"
                    ? messages.previewError
                    : messages.previewBuilding}
              </CardDescription>
            </div>
            <Badge variant="outline">standard-4x3</Badge>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-line bg-paper" data-editor-preview="standard-4x3">
              {readyPreview ? (
                <VoxelView
                  className="absolute inset-0 h-full aspect-auto rounded-none border-0 shadow-none"
                  page={readyPreview.page}
                  state={readyPreview.runtime}
                  entityId={draft.entityId}
                  locale={locale}
                  readOnly
                  messages={messages}
                  materialColors={materialColors}
                />
              ) : (
                <div className="grid h-full place-items-center p-6 text-center text-sm text-muted" role="status">
                  {previewStatus === "error" ? messages.previewError : messages.previewBuilding}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      <p className="sr-only" aria-live="polite">
        {messages.formatCounts(view.totalCount, view.activeLayerCount)} · {previewStatus === "ready" ? messages.previewReady : previewStatus === "error" ? messages.previewError : messages.previewBuilding}
      </p>
    </section>
  );
}

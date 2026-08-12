"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Beaker, Eraser, GitCompareArrows, Paintbrush, Palette, Presentation, Shapes } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  SPATIAL_COMMAND_VERSION,
  buildVoxelAuthoringDiff,
  clearVoxelFacePaint,
  createVoxelFacePaintState,
  createInitialSpatialRuntimeState,
  createVoxelSet,
  paintAllExteriorVoxelFaces,
  reduceSpatialRuntimeState,
  summarizeVoxelFacePaint,
  toggleExteriorVoxelFacePaint,
  type Axis,
  type OrthographicView,
  type SpatialCommandActor,
  type SpatialCommandPayload,
  type SpatialRuntimeState,
  type VoxelAuthoringDiffBuildResult,
  type VoxelAuthoringDraft,
  type VoxelCoordinate,
  type VoxelFaceSelection,
  type VoxelLessonCamera,
  type VoxelLessonStep,
} from "@/features/spatial-math/domain";
import {
  VoxelAuthoringWorkflowStage,
  type VoxelAuthoringWorkflowMessages,
} from "@/features/spatial-math/editor/VoxelAuthoringWorkflowStage";
import type { VoxelLessonEditorMessages } from "@/features/spatial-math/editor/VoxelLessonEditorStage";
import type { VoxelTemplateEditorMessages } from "@/features/spatial-math/editor/VoxelTemplateEditorStage";
import {
  VoxelTeachingStage,
  type VoxelTeachingMessages,
} from "@/features/spatial-math/renderer-r3f/VoxelTeachingStage";
import type { VoxelRendererMessages } from "@/features/spatial-math/renderer-r3f/VoxelFallback";
import type { ToolComponentProps } from "../types";
import {
  SPATIAL_LAB_DEFAULT_PRESET_ID,
  SPATIAL_LAB_PRESETS,
  SPATIAL_LAB_SURFACE_PAINT_PRESET_ID,
  createSpatialLabPresetDraft,
  type SpatialLabPresetId,
} from "./preset";

const TEACHER_ACTOR: SpatialCommandActor = {
  kind: "teacher-controller",
  actorId: "tool.spatial-lab.teacher",
};

type ArtifactState =
  | { readonly draft: VoxelAuthoringDraft; readonly status: "building" }
  | { readonly draft: VoxelAuthoringDraft; readonly status: "error" }
  | {
      readonly draft: VoxelAuthoringDraft;
      readonly status: "ready";
      readonly result: VoxelAuthoringDiffBuildResult;
    };

type LabTab = "authoring" | "classroom" | "changes";

function localizedKindKey(kind: VoxelLessonStep["kind"]): string {
  return kind === "layer-scan" ? "layerScan" : kind;
}

type SpatialLabPage = VoxelAuthoringDiffBuildResult["afterPreview"]["build"]["page"];

interface SurfacePaintMessages {
  readonly title: string;
  readonly description: string;
  readonly paintAll: string;
  readonly clear: string;
  readonly paintedFaces: (painted: number, total: number) => string;
  readonly histogramLabel: string;
  readonly histogramItem: (faces: number, count: number) => string;
}

function ClassroomRehearsal({
  page,
  entityId,
  locale,
  messages,
  cells,
  paintEnabled,
  paintMessages,
}: {
  readonly page: SpatialLabPage;
  readonly entityId: string;
  readonly locale: "zh" | "en";
  readonly messages: VoxelTeachingMessages;
  readonly cells: readonly VoxelCoordinate[];
  readonly paintEnabled: boolean;
  readonly paintMessages: SurfacePaintMessages;
}) {
  const [runtime, setRuntime] = useState<SpatialRuntimeState>(() =>
    createInitialSpatialRuntimeState(page),
  );
  const voxels = useMemo(() => createVoxelSet(cells), [cells]);
  const [paint, setPaint] = useState(() => createVoxelFacePaintState({
    entityId,
    materialToken: "voxel.paint",
  }));
  const paintSummary = useMemo(() => summarizeVoxelFacePaint(voxels, paint), [paint, voxels]);

  const applyCommandIntent = useCallback((payload: SpatialCommandPayload) => {
    setRuntime((current) => {
      const sequence = current.lastAppliedSequence + 1;
      return reduceSpatialRuntimeState(page, current, {
        commandVersion: SPATIAL_COMMAND_VERSION,
        commandId: `tool.spatial-lab.${current.resetEpoch}.${sequence}`,
        sceneRevisionHash: page.sceneHash,
        resetEpoch: current.resetEpoch,
        sequence,
        delivery: "durable-semantic",
        branch: current.branch,
        actor: TEACHER_ACTOR,
        payload,
      });
    });
  }, [page]);

  const togglePaintedFace = useCallback((face: VoxelFaceSelection) => {
    setPaint((current) => toggleExteriorVoxelFacePaint(voxels, current, face));
  }, [voxels]);

  return (
    <div className="space-y-4">
      {paintEnabled ? (
        <Card
          data-surface-paint-controls="voxel-face-paint-v1"
          data-painted-face-count={paintSummary.paintedUnitFaces}
        >
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Palette aria-hidden="true" className="size-4 text-rose" />
              {paintMessages.title}
            </CardTitle>
            <CardDescription>{paintMessages.description}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 pt-2 lg:grid-cols-[auto_1fr] lg:items-end">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={paintSummary.complete}
                onClick={() => setPaint((current) => paintAllExteriorVoxelFaces(voxels, current))}
              >
                <Paintbrush aria-hidden="true" className="size-4" />
                {paintMessages.paintAll}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={paintSummary.paintedUnitFaces === 0}
                onClick={() => setPaint((current) => clearVoxelFacePaint(current))}
              >
                <Eraser aria-hidden="true" className="size-4" />
                {paintMessages.clear}
              </Button>
            </div>
            <div>
              <p className="text-sm font-medium text-ink" role="status">
                {paintMessages.paintedFaces(
                  paintSummary.paintedUnitFaces,
                  paintSummary.totalExteriorUnitFaces,
                )}
              </p>
              <p className="mt-1 text-xs text-muted">{paintMessages.histogramLabel}</p>
              <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                {paintSummary.histogram.map((count, faces) => (
                  <Badge key={faces} variant={count > 0 ? "secondary" : "outline"} className="justify-center tabular-nums">
                    {paintMessages.histogramItem(faces, count)}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
      <VoxelTeachingStage
        page={page}
        state={runtime}
        entityId={entityId}
        actor={TEACHER_ACTOR}
        locale={locale}
        messages={messages}
        onCommandIntent={applyCommandIntent}
        materialColors={{ "voxel.base": "#8fbf88" }}
        paintedFaces={paintEnabled ? paint.faces : undefined}
        paintedFaceMaterialToken={paint.materialToken}
        onFaceSelect={paintEnabled ? togglePaintedFace : undefined}
      />
    </div>
  );
}

export function SpatialLab({ embedded = false }: ToolComponentProps) {
  const t = useTranslations("tools.spatialLab");
  const locale = useLocale() === "en" ? "en" : "zh";
  const [activePresetId, setActivePresetId] = useState<SpatialLabPresetId>(SPATIAL_LAB_DEFAULT_PRESET_ID);
  const initialDraft = useMemo(() => createSpatialLabPresetDraft(activePresetId), [activePresetId]);
  const [draft, setDraft] = useState<VoxelAuthoringDraft>(initialDraft);
  const [activeTab, setActiveTab] = useState<LabTab>("authoring");
  const [artifacts, setArtifacts] = useState<ArtifactState>({
    draft: initialDraft,
    status: "building",
  });

  useEffect(() => {
    let current = true;
    void buildVoxelAuthoringDiff(initialDraft, draft).then(
      (result) => {
        if (current) setArtifacts({ draft, status: "ready", result });
      },
      () => {
        if (current) setArtifacts({ draft, status: "error" });
      },
    );
    return () => {
      current = false;
    };
  }, [draft, initialDraft]);

  const visibleArtifacts = artifacts.draft === draft ? artifacts : { draft, status: "building" } as const;
  const readyResult = visibleArtifacts.status === "ready" ? visibleArtifacts.result : null;
  const page = readyResult?.afterPreview.build.page ?? null;
  const selectPreset = (presetId: SpatialLabPresetId) => {
    const nextDraft = createSpatialLabPresetDraft(presetId);
    setActivePresetId(presetId);
    setDraft(nextDraft);
    setArtifacts({ draft: nextDraft, status: "building" });
  };

  const rendererMessages = useMemo<VoxelRendererMessages>(() => ({
    webglUnavailable: t("renderer.webglUnavailable"),
    contextLost: t("renderer.contextLost"),
    unrevealedCount: t("renderer.unrevealedCount"),
    formatProjection: (view: OrthographicView) => t(`renderer.projections.${view}`),
    formatLayerCount: (label: string, count: number | null, visible: boolean) =>
      count === null
        ? t("renderer.layerCountUnrevealed", { label })
        : t("renderer.layerCount", {
            label,
            count,
            visibility: visible ? t("renderer.visible") : t("renderer.hidden"),
          }),
    formatTotalCount: (count: number) => t("renderer.totalCount", { count }),
    formatHiddenByLayerCount: (count: number) => t("renderer.hiddenByLayer", { count }),
    formatProjectedCell: (u: number, v: number, stackSize: number | null) =>
      stackSize === null
        ? t("renderer.projectedCellUnrevealed", { u, v })
        : t("renderer.projectedCell", { u, v, count: stackSize }),
  }), [t]);

  const teachingMessages = useMemo<VoxelTeachingMessages>(() => ({
    ...rendererMessages,
    previousStep: t("teaching.previousStep"),
    nextStep: t("teaching.nextStep"),
    playSteps: t("teaching.playSteps"),
    pauseSteps: t("teaching.pauseSteps"),
    resetScene: t("teaching.resetScene"),
    cameraBookmarks: t("teaching.cameraBookmarks"),
    axisSnap: t("teaching.axisSnap"),
    enableAxisSnap: t("teaching.enableAxisSnap"),
    disableAxisSnap: t("teaching.disableAxisSnap"),
    layers: t("teaching.layers"),
    countPlaceholder: t("teaching.countPlaceholder"),
    submitCount: t("teaching.submitCount"),
    teacherFollow: t("teaching.teacherFollow"),
    studentLocalExplore: t("teaching.studentLocalExplore"),
    studentSubmit: t("teaching.studentSubmit"),
    formatStepPosition: (current: number, total: number) =>
      t("teaching.stepPosition", { current, total }),
    formatLayerAction: (label: string, currentlyVisible: boolean) =>
      currentlyVisible
        ? t("teaching.hideLayer", { label })
        : t("teaching.showLayer", { label }),
  }), [rendererMessages, t]);

  const paintMessages = useMemo<SurfacePaintMessages>(() => ({
    title: t("paint.title"),
    description: t("paint.description"),
    paintAll: t("paint.paintAll"),
    clear: t("paint.clear"),
    paintedFaces: (painted: number, total: number) => t("paint.paintedFaces", { painted, total }),
    histogramLabel: t("paint.histogramLabel"),
    histogramItem: (faces: number, count: number) => t("paint.histogramItem", { faces, count }),
  }), [t]);

  const modelMessages = useMemo<VoxelTemplateEditorMessages>(() => ({
    ...rendererMessages,
    editorTitle: t("model.editorTitle"),
    editorDescription: t("model.editorDescription"),
    axisLabel: t("model.axisLabel"),
    layersLabel: t("model.layersLabel"),
    gridLabel: t("model.gridLabel"),
    previewLabel: t("model.previewLabel"),
    previewBuilding: t("common.previewBuilding"),
    previewReady: t("common.previewReady"),
    previewError: t("common.previewError"),
    undo: t("common.undo"),
    redo: t("common.redo"),
    resetDraft: t("common.resetDraft"),
    modified: t("common.modified"),
    saved: t("common.initialState"),
    performanceWarning: t("model.performanceWarning"),
    formatAxis: (axis: Axis) => t(`model.axes.${axis}`),
    formatLayer: (coordinate: number, count: number) =>
      t("model.layer", { coordinate, count }),
    formatGridCell: (coordinate: VoxelCoordinate, occupied: boolean) =>
      occupied
        ? t("model.removeCell", { x: coordinate.x, y: coordinate.y, z: coordinate.z })
        : t("model.addCell", { x: coordinate.x, y: coordinate.y, z: coordinate.z }),
    formatCounts: (total: number, activeLayer: number) =>
      t("model.counts", { total, activeLayer }),
  }), [rendererMessages, t]);

  const lessonMessages = useMemo<VoxelLessonEditorMessages>(() => ({
    ...teachingMessages,
    editorTitle: t("lesson.editorTitle"),
    editorDescription: t("lesson.editorDescription"),
    stepsLabel: t("lesson.stepsLabel"),
    addView: t("lesson.addView"),
    inspectorLabel: t("lesson.inspectorLabel"),
    chinese: t("lesson.chinese"),
    english: t("lesson.english"),
    titleLabel: t("lesson.titleLabel"),
    promptLabel: t("lesson.promptLabel"),
    titlePlaceholder: t("lesson.titlePlaceholder"),
    promptPlaceholder: t("lesson.promptPlaceholder"),
    moveUp: t("lesson.moveUp"),
    moveDown: t("lesson.moveDown"),
    removeStep: t("lesson.removeStep"),
    undo: t("common.undo"),
    redo: t("common.redo"),
    resetDraft: t("common.resetDraft"),
    modified: t("common.modified"),
    saved: t("common.initialState"),
    layerOrder: t("lesson.layerOrder"),
    ascending: t("lesson.ascending"),
    descending: t("lesson.descending"),
    checkpointTitle: t("lesson.checkpointTitle"),
    checkpointDescription: t("lesson.checkpointDescription"),
    checkpointRequired: t("lesson.checkpointRequired"),
    checkpointOptional: t("lesson.checkpointOptional"),
    maxSubmissions: t("lesson.maxSubmissions"),
    decreaseSubmissions: t("lesson.decreaseSubmissions"),
    increaseSubmissions: t("lesson.increaseSubmissions"),
    previewLabel: t("lesson.previewLabel"),
    previewBuilding: t("common.previewBuilding"),
    previewReady: t("common.previewReady"),
    previewError: t("common.previewError"),
    invalidText: t("lesson.invalidText"),
    chineseRequiredBeforeEnglish: t("lesson.chineseRequiredBeforeEnglish"),
    englishFallback: t("lesson.englishFallback"),
    formatCamera: (camera: VoxelLessonCamera) => t(`lesson.cameras.${camera}`),
    formatStepKind: (kind: VoxelLessonStep["kind"]) =>
      t(`lesson.stepKinds.${localizedKindKey(kind)}`),
    formatStepPosition: (current: number, total: number) =>
      t("lesson.stepPosition", { current, total }),
    formatExpandedLayers: (count: number) => t("lesson.expandedLayers", { count }),
  }), [t, teachingMessages]);

  const workflowMessages = useMemo<VoxelAuthoringWorkflowMessages>(() => ({
    workflowTitle: t("workflow.title"),
    workflowDescription: t("workflow.description"),
    panelsLabel: t("workflow.panelsLabel"),
    modelTab: t("workflow.modelTab"),
    lessonTab: t("workflow.lessonTab"),
    modelEditor: modelMessages,
    lessonEditor: lessonMessages,
  }), [lessonMessages, modelMessages, t]);

  const diff = readyResult?.diff ?? null;
  const modelChanges = diff
    ? diff.authored.model.cellsAdded.length +
      diff.authored.model.cellsRemoved.length +
      diff.authored.model.scalarChanges.length +
      diff.authored.model.localizedChanges.length +
      diff.authored.model.termIds.added.length +
      diff.authored.model.termIds.removed.length +
      diff.authored.model.prerequisiteTermIds.added.length +
      diff.authored.model.prerequisiteTermIds.removed.length
    : 0;
  const lessonChanges = diff
    ? diff.authored.lesson.stepsAdded.length +
      diff.authored.lesson.stepsRemoved.length +
      diff.authored.lesson.stepsMoved.length +
      diff.authored.lesson.stepsChanged.length
    : 0;
  const checkpointChanges = diff ? Object.keys(diff.authored.lesson.checkpoint).length : 0;
  const changed = Boolean(diff && diff.before.draftHash !== diff.after.draftHash);
  const beforeTotal = diff?.derived.voxelMath?.before.totalCount ?? initialDraft.model.cells.length;
  const afterTotal = diff?.derived.voxelMath?.after.totalCount ?? draft.model.cells.length;
  const beforeLayers = diff?.derived.layerSteps?.before.length ??
    new Set(initialDraft.model.cells.map((cell) => cell[initialDraft.model.layerAxis])).size;
  const afterLayers = diff?.derived.layerSteps?.after.length ??
    new Set(draft.model.cells.map((cell) => cell[draft.model.layerAxis])).size;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-paper text-ink"
      data-tool="spatial-lab"
      data-layout-profile="standard-4x3"
      data-spatial-preset={activePresetId}
    >
      <div className="border-b border-line bg-moon/15 px-4 py-3 md:px-6">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{t("prototypeBadge")}</Badge>
              <Badge variant="outline">standard-4x3</Badge>
              <Badge variant="secondary">{t("memoryOnly")}</Badge>
            </div>
            {!embedded ? <p className="mt-2 text-sm leading-6 text-muted">{t("prototypeNote")}</p> : null}
          </div>
          <div className="grid w-full gap-2 sm:w-80">
            <div>
              <p className="text-xs font-medium text-ink">{t("presets.label")}</p>
              <p className="mt-0.5 text-xs leading-5 text-muted">{t("presets.description")}</p>
            </div>
            <Select value={activePresetId} onValueChange={(value) => selectPreset(value as SpatialLabPresetId)}>
              <SelectTrigger className="w-full" aria-label={t("presets.label")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPATIAL_LAB_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {t(`presets.options.${preset.messageKey}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs leading-5 text-muted">{t("boundaryNote")}</p>
          </div>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as LabTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="overflow-x-auto border-b border-line px-4 py-2 md:px-6">
          <TabsList aria-label={t("workspaceTabs")} className="min-w-max">
            <TabsTrigger value="authoring" className="gap-2">
              <Shapes aria-hidden="true" className="size-4" />
              {t("authoringTab")}
            </TabsTrigger>
            <TabsTrigger value="classroom" className="gap-2">
              <Presentation aria-hidden="true" className="size-4" />
              {t("classroomTab")}
            </TabsTrigger>
            <TabsTrigger value="changes" className="gap-2">
              <GitCompareArrows aria-hidden="true" className="size-4" />
              {t("changesTab")}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="authoring" className="mt-0 min-h-0 flex-1 overflow-auto p-3 md:p-5">
          <div className="mx-auto max-w-[1500px]">
            <VoxelAuthoringWorkflowStage
              key={activePresetId}
              initialDraft={initialDraft}
              locale={locale}
              messages={workflowMessages}
              onDraftChange={setDraft}
              materialColors={{ "voxel.base": "#8fbf88" }}
            />
          </div>
        </TabsContent>

        <TabsContent value="classroom" className="mt-0 min-h-0 flex-1 overflow-auto p-3 md:p-5">
          <div className="mx-auto max-w-5xl space-y-4">
            <Card>
              <CardHeader className="p-4">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Presentation aria-hidden="true" className="size-4 text-leaf-deep" />
                  {t("classroom.title")}
                </CardTitle>
                <CardDescription>{t("classroom.description")}</CardDescription>
              </CardHeader>
            </Card>
            {page ? (
              <ClassroomRehearsal
                key={page.sceneHash}
                page={page}
                entityId={draft.model.entityId}
                locale={locale}
                messages={teachingMessages}
                cells={draft.model.cells}
                paintEnabled={activePresetId === SPATIAL_LAB_SURFACE_PAINT_PRESET_ID}
                paintMessages={paintMessages}
              />
            ) : (
              <Card className="grid aspect-[4/3] place-items-center">
                <CardContent className="p-6 text-center text-sm text-muted" role="status">
                  {visibleArtifacts.status === "error" ? t("common.previewError") : t("common.previewBuilding")}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="changes" className="mt-0 min-h-0 flex-1 overflow-auto p-3 md:p-5">
          <div className="mx-auto max-w-5xl space-y-4">
            <Card>
              <CardHeader className="p-4">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Beaker aria-hidden="true" className="size-4 text-leaf-deep" />
                  {t("changes.title")}
                </CardTitle>
                <CardDescription>
                   {visibleArtifacts.status === "building"
                      ? t("common.previewBuilding")
                      : visibleArtifacts.status === "error"
                      ? t("common.previewError")
                      : changed
                        ? t("changes.changed")
                        : t("changes.unchanged")}
                </CardDescription>
              </CardHeader>
            </Card>
            {diff ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  [t("changes.modelChanges"), modelChanges],
                  [t("changes.lessonChanges"), lessonChanges],
                  [t("changes.checkpointChanges"), checkpointChanges],
                  [t("changes.totalChanges"), modelChanges + lessonChanges + checkpointChanges],
                ].map(([label, value]) => (
                  <Card key={String(label)}>
                    <CardHeader className="p-4">
                      <CardDescription>{label}</CardDescription>
                      <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            ) : null}
            {diff ? (
              <Card>
                <CardContent className="grid gap-4 p-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-muted">{t("changes.voxelCount")}</p>
                    <p className="mt-1 text-lg font-medium tabular-nums">{beforeTotal} → {afterTotal}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">{t("changes.layerCount")}</p>
                    <p className="mt-1 text-lg font-medium tabular-nums">{beforeLayers} → {afterLayers}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">{t("changes.diffHash")}</p>
                    <p className="mt-1 truncate font-mono text-sm" title={readyResult?.diffHash}>
                      {readyResult?.diffHash.slice(0, 16)}…
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

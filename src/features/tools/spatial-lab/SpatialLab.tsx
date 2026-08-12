"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Beaker, Box, Eraser, GitCompareArrows, Hammer, Paintbrush, Palette, Presentation, Shapes } from "lucide-react";
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
  createVoxelCarvingState,
  createVoxelFacePaintState,
  createInitialSpatialRuntimeState,
  createVoxelSet,
  buildRectangularPrismMeasurement,
  measureRectangularPrismCells,
  paintAllExteriorVoxelFaces,
  replaceVoxelAuthoringModel,
  replaceVoxelCarvingCells,
  reduceSpatialRuntimeState,
  summarizeVoxelFacePaint,
  summarizeVoxelCarving,
  toggleExteriorVoxelFacePaint,
  type Axis,
  type OrthographicView,
  type RectangularPrismDimensions,
  type RectangularPrismMeasurement,
  type SpatialCommandActor,
  type SpatialCommandPayload,
  type SpatialRuntimeState,
  type VoxelAuthoringDiffBuildResult,
  type VoxelAuthoringDraft,
  type VoxelCoordinate,
  type VoxelCarvingState,
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
  SPATIAL_LAB_ACTIVITIES,
  SPATIAL_LAB_CUBE_NET_FOLD_PRESET_ID,
  SPATIAL_LAB_DEFAULT_PRESET_ID,
  SPATIAL_LAB_HOLLOWING_PRESET_ID,
  SPATIAL_LAB_MEASUREMENT_PRESET_ID,
  SPATIAL_LAB_SURFACE_PAINT_PRESET_ID,
  createSpatialLabPresetDraft,
  isSpatialLabVoxelPresetId,
  type SpatialLabActivityId,
} from "./preset";
import { CubeNetFoldWorkspace } from "./CubeNetFoldWorkspace";
import {
  RectangularPrismMeasurementPanel,
  type RectangularPrismMeasurementMessages,
} from "./RectangularPrismMeasurementPanel";

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

type CarvingProfileId = "solid" | "topDent" | "sealed" | "opened" | "tunnel";

const CARVING_PROFILES: readonly {
  readonly id: CarvingProfileId;
  readonly removedCells: readonly VoxelCoordinate[];
}[] = [
  { id: "solid", removedCells: [] },
  { id: "topDent", removedCells: [{ x: 1, y: 2, z: 1 }] },
  { id: "sealed", removedCells: [{ x: 1, y: 1, z: 1 }] },
  { id: "opened", removedCells: [{ x: 1, y: 1, z: 1 }, { x: 1, y: 2, z: 1 }] },
  { id: "tunnel", removedCells: [{ x: 1, y: 1, z: 0 }, { x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 2 }] },
];

interface CarvingMessages {
  readonly title: string;
  readonly description: string;
  readonly profilesLabel: string;
  readonly profile: (profileId: CarvingProfileId) => string;
  readonly originalVolume: string;
  readonly removedVolume: string;
  readonly remainingVolume: string;
  readonly totalSurface: string;
  readonly exteriorSurface: string;
  readonly interiorSurface: string;
  readonly cavityVolume: string;
  readonly formatMetric: (label: string, value: number) => string;
}

function runtimeForCarving(
  page: SpatialLabPage,
  entityId: string,
  removedCells: readonly VoxelCoordinate[],
): SpatialRuntimeState {
  const initial = createInitialSpatialRuntimeState(page);
  if (removedCells.length === 0) return initial;
  return reduceSpatialRuntimeState(page, initial, {
    commandVersion: SPATIAL_COMMAND_VERSION,
    commandId: "tool.spatial-lab.carving.1",
    sceneRevisionHash: page.sceneHash,
    resetEpoch: initial.resetEpoch,
    sequence: initial.lastAppliedSequence + 1,
    delivery: "durable-semantic",
    branch: initial.branch,
    actor: TEACHER_ACTOR,
    payload: { kind: "voxel.remove", entityId, cells: [...removedCells] },
  });
}

function ClassroomRehearsal({
  page,
  entityId,
  locale,
  messages,
  cells,
  paintEnabled,
  paintMessages,
  carvingEnabled,
  carvingMessages,
}: {
  readonly page: SpatialLabPage;
  readonly entityId: string;
  readonly locale: "zh" | "en";
  readonly messages: VoxelTeachingMessages;
  readonly cells: readonly VoxelCoordinate[];
  readonly paintEnabled: boolean;
  readonly paintMessages: SurfacePaintMessages;
  readonly carvingEnabled: boolean;
  readonly carvingMessages: CarvingMessages;
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
  const [carving, setCarving] = useState<VoxelCarvingState>(() => createVoxelCarvingState({ entityId }));
  const [carvingProfile, setCarvingProfile] = useState<CarvingProfileId>("solid");
  const carvingSummary = useMemo(() => summarizeVoxelCarving(voxels, carving), [carving, voxels]);

  const applyCommandIntent = useCallback((payload: SpatialCommandPayload) => {
    if (carvingEnabled && payload.kind === "scene.reset") {
      setCarving(createVoxelCarvingState({ entityId }));
      setCarvingProfile("solid");
    }
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
  }, [carvingEnabled, entityId, page]);

  const togglePaintedFace = useCallback((face: VoxelFaceSelection) => {
    setPaint((current) => toggleExteriorVoxelFacePaint(voxels, current, face));
  }, [voxels]);

  const applyCarvingProfile = useCallback((profileId: CarvingProfileId) => {
    const profile = CARVING_PROFILES.find((candidate) => candidate.id === profileId);
    if (!profile) return;
    const next = replaceVoxelCarvingCells(voxels, carving, profile.removedCells);
    setCarving(next);
    setCarvingProfile(profileId);
    setRuntime(runtimeForCarving(page, entityId, next.removedCells));
  }, [carving, entityId, page, voxels]);

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
      {carvingEnabled ? (
        <Card
          data-carving-controls="voxel-carving-v1"
          data-carving-profile={carvingProfile}
          data-removed-voxel-count={carvingSummary.removedVolume}
        >
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Hammer aria-hidden="true" className="size-4 text-rose" />
              {carvingMessages.title}
            </CardTitle>
            <CardDescription>{carvingMessages.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-2">
            <div className="flex flex-wrap gap-2" aria-label={carvingMessages.profilesLabel}>
              {CARVING_PROFILES.map((profile) => (
                <Button
                  key={profile.id}
                  type="button"
                  size="sm"
                  variant={carvingProfile === profile.id ? "secondary" : "ghost"}
                  className={carvingProfile === profile.id ? "bg-moon/70" : undefined}
                  aria-pressed={carvingProfile === profile.id}
                  onClick={() => applyCarvingProfile(profile.id)}
                >
                  {profile.id === "solid" ? <Box aria-hidden="true" className="size-4" /> : null}
                  {carvingMessages.profile(profile.id)}
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" role="status">
              {[
                [carvingMessages.originalVolume, carvingSummary.originalVolume],
                [carvingMessages.removedVolume, carvingSummary.removedVolume],
                [carvingMessages.remainingVolume, carvingSummary.remainingVolume],
                [carvingMessages.totalSurface, carvingSummary.totalSurfaceArea],
                [carvingMessages.exteriorSurface, carvingSummary.exteriorSurfaceArea],
                [carvingMessages.interiorSurface, carvingSummary.interiorSurfaceArea],
                [carvingMessages.cavityVolume, carvingSummary.enclosedCavityVolume],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl border border-line bg-moon/10 px-3 py-2">
                  <p className="text-xs text-muted">{label}</p>
                  <p className="mt-0.5 text-lg font-medium tabular-nums" aria-label={carvingMessages.formatMetric(String(label), Number(value))}>
                    {value}
                  </p>
                </div>
              ))}
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
  const [activeActivityId, setActiveActivityId] = useState<SpatialLabActivityId>(SPATIAL_LAB_DEFAULT_PRESET_ID);
  const activeVoxelPresetId = isSpatialLabVoxelPresetId(activeActivityId) ? activeActivityId : null;
  const initialDraft = useMemo(
    () => createSpatialLabPresetDraft(activeVoxelPresetId ?? SPATIAL_LAB_DEFAULT_PRESET_ID),
    [activeVoxelPresetId],
  );
  const [draft, setDraft] = useState<VoxelAuthoringDraft>(initialDraft);
  const [workflowRevision, setWorkflowRevision] = useState(0);
  const [activeTab, setActiveTab] = useState<LabTab>("authoring");
  const [artifacts, setArtifacts] = useState<ArtifactState>({
    draft: initialDraft,
    status: "building",
  });

  useEffect(() => {
    if (!activeVoxelPresetId) return;
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
  }, [activeVoxelPresetId, draft, initialDraft]);

  const visibleArtifacts = artifacts.draft === draft ? artifacts : { draft, status: "building" } as const;
  const readyResult = visibleArtifacts.status === "ready" ? visibleArtifacts.result : null;
  const page = readyResult?.afterPreview.build.page ?? null;
  const selectActivity = (activityId: SpatialLabActivityId) => {
    setActiveActivityId(activityId);
    if (!isSpatialLabVoxelPresetId(activityId)) return;
    const nextDraft = createSpatialLabPresetDraft(activityId);
    setDraft(nextDraft);
    setActiveTab("authoring");
    setWorkflowRevision((current) => current + 1);
    setArtifacts({ draft: nextDraft, status: "building" });
  };

  const measurementEnabled = activeActivityId === SPATIAL_LAB_MEASUREMENT_PRESET_ID;
  const measurement = useMemo<RectangularPrismMeasurement | null | undefined>(() => {
    if (!measurementEnabled) return undefined;
    try {
      return measureRectangularPrismCells({ unit: "unit", occupiedCells: draft.model.cells });
    } catch {
      return null;
    }
  }, [draft.model.cells, measurementEnabled]);

  const updateMeasurementDimensions = useCallback((dimensions: RectangularPrismDimensions) => {
    const nextMeasurement = buildRectangularPrismMeasurement({ dimensions, unit: "unit" });
    setDraft((current) => replaceVoxelAuthoringModel(current, {
      ...current.model,
      cells: nextMeasurement.occupiedCells,
    }));
    setWorkflowRevision((current) => current + 1);
  }, []);

  const restoreMeasurement = useCallback(() => {
    const restored = createSpatialLabPresetDraft(SPATIAL_LAB_MEASUREMENT_PRESET_ID);
    setDraft((current) => replaceVoxelAuthoringModel(current, {
      ...current.model,
      cells: restored.model.cells,
    }));
    setWorkflowRevision((current) => current + 1);
  }, []);

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

  const carvingMessages = useMemo<CarvingMessages>(() => ({
    title: t("carving.title"),
    description: t("carving.description"),
    profilesLabel: t("carving.profilesLabel"),
    profile: (profileId: CarvingProfileId) => t(`carving.profiles.${profileId}`),
    originalVolume: t("carving.originalVolume"),
    removedVolume: t("carving.removedVolume"),
    remainingVolume: t("carving.remainingVolume"),
    totalSurface: t("carving.totalSurface"),
    exteriorSurface: t("carving.exteriorSurface"),
    interiorSurface: t("carving.interiorSurface"),
    cavityVolume: t("carving.cavityVolume"),
    formatMetric: (label: string, value: number) => t("carving.metric", { label, value }),
  }), [t]);

  const measurementMessages = useMemo<RectangularPrismMeasurementMessages>(() => ({
    title: t("measurement.title"),
    description: t("measurement.description"),
    dimensionsLabel: t("measurement.dimensionsLabel"),
    dimension: {
      length: t("measurement.length"),
      width: t("measurement.width"),
      height: t("measurement.height"),
    },
    decreaseDimension: (dimension: string) => t("measurement.decreaseDimension", { dimension }),
    increaseDimension: (dimension: string) => t("measurement.increaseDimension", { dimension }),
    restorePrism: t("measurement.restorePrism"),
    invalidShapeTitle: t("measurement.invalidShapeTitle"),
    invalidShapeDescription: t("measurement.invalidShapeDescription"),
    boundary: t("measurement.boundary"),
    volume: t("measurement.volume"),
    surfaceArea: t("measurement.surfaceArea"),
    volumeValue: (value: number) => t("measurement.volumeValue", { value }),
    surfaceValue: (value: number) => t("measurement.surfaceValue", { value }),
    liveSummary: (value: RectangularPrismMeasurement) => t("measurement.liveSummary", {
      ...value.dimensions,
      volume: value.volume.value,
      surface: value.surfaceArea.value,
    }),
    volumeFormula: (value: RectangularPrismMeasurement) => t("measurement.volumeFormula", {
      ...value.dimensions,
      volume: value.volume.value,
    }),
    surfaceFormula: (value: RectangularPrismMeasurement) => t("measurement.surfaceFormula", {
      lengthWidth: value.dimensions.length * value.dimensions.width,
      lengthHeight: value.dimensions.length * value.dimensions.height,
      widthHeight: value.dimensions.width * value.dimensions.height,
      surface: value.surfaceArea.value,
    }),
    facePairs: t("measurement.facePairs"),
    facePairLabel: {
      "length-width": t("measurement.lengthWidthFaces"),
      "length-height": t("measurement.lengthHeightFaces"),
      "width-height": t("measurement.widthHeightFaces"),
    },
    facePairFormula: (label: string, first: number, second: number, value: number) =>
      t("measurement.facePairFormula", { label, first, second, value }),
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
      data-spatial-preset={activeActivityId}
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
            <Select value={activeActivityId} onValueChange={(value) => selectActivity(value as SpatialLabActivityId)}>
              <SelectTrigger className="w-full" aria-label={t("presets.label")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPATIAL_LAB_ACTIVITIES.map((activity) => (
                  <SelectItem key={activity.id} value={activity.id}>
                    {t(`presets.options.${activity.messageKey}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs leading-5 text-muted">{t("boundaryNote")}</p>
          </div>
        </div>
      </div>

      {activeActivityId === SPATIAL_LAB_CUBE_NET_FOLD_PRESET_ID ? (
        <CubeNetFoldWorkspace locale={locale} />
      ) : <Tabs
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
            {measurementEnabled ? (
              <div className="space-y-4">
                <RectangularPrismMeasurementPanel
                  measurement={measurement ?? null}
                  messages={measurementMessages}
                  onDimensionsChange={updateMeasurementDimensions}
                  onRestore={restoreMeasurement}
                />
                <VoxelAuthoringWorkflowStage
                  key={`${activeActivityId}:${workflowRevision}`}
                  initialDraft={draft}
                  locale={locale}
                  messages={workflowMessages}
                  onDraftChange={setDraft}
                  materialColors={{ "voxel.base": "#8fbf88" }}
                />
              </div>
            ) : (
              <VoxelAuthoringWorkflowStage
                key={`${activeActivityId}:${workflowRevision}`}
                initialDraft={draft}
                locale={locale}
                messages={workflowMessages}
                onDraftChange={setDraft}
                materialColors={{ "voxel.base": "#8fbf88" }}
              />
            )}
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
            {measurementEnabled ? (
              <RectangularPrismMeasurementPanel
                measurement={measurement ?? null}
                messages={measurementMessages}
                onDimensionsChange={updateMeasurementDimensions}
                onRestore={restoreMeasurement}
              />
            ) : null}
            {page ? (
              <ClassroomRehearsal
                key={page.sceneHash}
                page={page}
                entityId={draft.model.entityId}
                locale={locale}
                messages={teachingMessages}
                cells={draft.model.cells}
                paintEnabled={activeActivityId === SPATIAL_LAB_SURFACE_PAINT_PRESET_ID}
                paintMessages={paintMessages}
                carvingEnabled={activeActivityId === SPATIAL_LAB_HOLLOWING_PRESET_ID}
                carvingMessages={carvingMessages}
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
      </Tabs>}
    </div>
  );
}

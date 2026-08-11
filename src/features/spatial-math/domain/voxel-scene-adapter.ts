import { canonicalSha256 } from "./canonical-json";
import { rational } from "./exact";
import {
  SPATIAL_PAGE_DOC_VERSION,
  materializeSpatialPageDoc,
  type SpatialPageDoc,
} from "./page-schema";
import { countVoxelLayers, primaryOrthographicProjections } from "./voxel-kernel";
import { parseSpatialScene, type SpatialScene } from "./scene-schema";
import { createVoxelSet } from "./voxel-schema";
import { SPATIAL_VOXEL_LIMITS, type Axis, type OrthographicProjection } from "./voxel-types";
import {
  parseVoxelSceneAdapterInput,
  VOXEL_SCENE_ADAPTER_VERSION,
  type VoxelSceneAdapterInput,
} from "./voxel-scene-adapter-schema";

export interface VoxelCountingSceneBuildResult {
  readonly adapterVersion: typeof VOXEL_SCENE_ADAPTER_VERSION;
  readonly scene: SpatialScene;
  readonly sceneHash: string;
  readonly totalCount: number;
  readonly layerCounts: readonly { readonly coordinate: number; readonly count: number }[];
  readonly projections: readonly OrthographicProjection[];
}

export interface VoxelCountingPageBuildResult extends VoxelCountingSceneBuildResult {
  readonly page: SpatialPageDoc;
}

function encodedCoordinate(value: number): string {
  return `c${String(value - SPATIAL_VOXEL_LIMITS.minCoordinate).padStart(4, "0")}`;
}

function cellId(cell: { readonly x: number; readonly y: number; readonly z: number }): string {
  return `cell.x${encodedCoordinate(cell.x)}.y${encodedCoordinate(cell.y)}.z${encodedCoordinate(cell.z)}`;
}

function layerId(axis: Axis, coordinate: number): string {
  return `layer.${axis}.${encodedCoordinate(coordinate)}`;
}

function projectionSummary(projection: OrthographicProjection) {
  const squares = projection.cells.length;
  const hidden = projection.hiddenVoxelCount;
  const names = {
    front: ["正面", "front"],
    right: ["右面", "right"],
    top: ["上面", "top"],
  } as const;
  const [zhName, enName] = names[projection.view as keyof typeof names];
  return {
    zh: `${zhName}看到 ${squares} 个方格，其中 ${hidden} 个单位块被遮挡。`,
    en: `The ${enName} view shows ${squares} squares with ${hidden} hidden unit cubes.`,
  };
}

function modelCenter(input: VoxelSceneAdapterInput) {
  const xs = input.cells.map((cell) => cell.x);
  const ys = input.cells.map((cell) => cell.y);
  const zs = input.cells.map((cell) => cell.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return {
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
    distance: Math.max(maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1) * 2.5 + 3,
  };
}

export async function buildVoxelCountingScene(inputValue: unknown): Promise<VoxelCountingSceneBuildResult> {
  const input = parseVoxelSceneAdapterInput(inputValue);
  const voxels = createVoxelSet(input.cells);
  const layerCounts = countVoxelLayers(voxels, input.layerAxis);
  const projectionRecord = primaryOrthographicProjections(voxels);
  const projections = [projectionRecord.front, projectionRecord.right, projectionRecord.top] as const;
  const { center, distance } = modelCenter(input);
  const layers = layerCounts.map((layer, index) => ({
    id: layerId(input.layerAxis, layer.coordinate),
    label: {
      zh: `第 ${index + 1} 层（${input.layerAxis}=${layer.coordinate}）`,
      en: `Layer ${index + 1} (${input.layerAxis}=${layer.coordinate})`,
    },
    initiallyVisible: true,
    selector: {
      kind: "voxel-axis-range" as const,
      entityId: input.entityId,
      axis: input.layerAxis,
      min: layer.coordinate,
      max: layer.coordinate,
    },
  }));
  const setAllLayers = (visibleLayerId: string | null) =>
    layers.map((layer) => ({ kind: "layer.set" as const, layerId: layer.id, visible: visibleLayerId === null || layer.id === visibleLayerId }));

  const scene = parseSpatialScene({
    schemaVersion: "spatial-scene-v1",
    sceneId: input.sceneId,
    title: input.title,
    localePolicy: "bilingual",
    learning: {
      capability: "P2",
      learningGoal: input.learningGoal,
      termIds: input.termIds,
      prerequisiteTermIds: input.prerequisiteTermIds,
      misconceptions: [input.misconception],
      teacherPrompts: [input.teacherPrompt],
    },
    space: { coordinateSystem: "right-handed-y-up", unit: "unit", gridStep: rational(1) },
    model: {
      entities: [
        {
          id: input.entityId,
          type: "voxel-set",
          label: input.title,
          visible: true,
          materialToken: input.materialToken,
          cells: input.cells.map((cell) => ({ id: cellId(cell), ...cell })),
        },
      ],
      parameters: [],
    },
    presentation: {
      background: "paper",
      lighting: "flat",
      showEdges: true,
      showAxes: false,
      cameraBookmarks: [
        { id: "camera.front", label: { zh: "正面", en: "Front" }, projection: "orthographic", position: { x: center.x, y: center.y, z: center.z + distance }, target: center, up: { x: 0, y: 1, z: 0 }, zoom: 1 },
        { id: "camera.perspective", label: { zh: "立体", en: "3D" }, projection: "perspective", position: { x: center.x + distance, y: center.y + distance * 0.8, z: center.z + distance }, target: center, up: { x: 0, y: 1, z: 0 }, fovDegrees: 38 },
        { id: "camera.right", label: { zh: "右面", en: "Right" }, projection: "orthographic", position: { x: center.x + distance, y: center.y, z: center.z }, target: center, up: { x: 0, y: 1, z: 0 }, zoom: 1 },
        { id: "camera.top", label: { zh: "上面", en: "Top" }, projection: "orthographic", position: { x: center.x, y: center.y + distance, z: center.z }, target: center, up: { x: 0, y: 0, z: -1 }, zoom: 1 },
      ],
      defaultCameraId: "camera.perspective",
      layers,
    },
    sequence: {
      initialStepId: "step.predict",
      steps: [
        { id: "step.predict", title: { zh: "先预测", en: "Predict" }, teacherPrompt: input.teacherPrompt, transition: "none", durationMs: 0, actions: [{ kind: "camera.apply", cameraId: "camera.perspective" }, ...setAllLayers(null)] },
        { id: "step.front", title: { zh: "看正面", en: "Front view" }, transition: "ease-in-out", durationMs: 600, actions: [{ kind: "camera.apply", cameraId: "camera.front" }, ...setAllLayers(null)] },
        { id: "step.right", title: { zh: "看右面", en: "Right view" }, transition: "ease-in-out", durationMs: 600, actions: [{ kind: "camera.apply", cameraId: "camera.right" }, ...setAllLayers(null)] },
        { id: "step.top", title: { zh: "看上面", en: "Top view" }, transition: "ease-in-out", durationMs: 600, actions: [{ kind: "camera.apply", cameraId: "camera.top" }, ...setAllLayers(null)] },
        ...layers.map((layer, index) => ({ id: `step.layer.${String(index + 1).padStart(3, "0")}`, title: { zh: `观察第 ${index + 1} 层`, en: `Observe layer ${index + 1}` }, transition: "none" as const, durationMs: 500, actions: [{ kind: "camera.apply" as const, cameraId: "camera.perspective" }, ...setAllLayers(layer.id)] })),
        { id: "step.verify", title: { zh: "合并验证", en: "Verify total" }, teacherPrompt: { zh: `把各层数量相加，再与整体核对。`, en: "Add the layer counts, then check the whole model." }, transition: "ease-in-out", durationMs: 650, actions: [{ kind: "camera.apply", cameraId: "camera.perspective" }, ...setAllLayers(null)] },
      ],
    },
    checkpoints: [
      {
        id: "checkpoint.total-count",
        type: "numeric",
        prompt: { zh: "一共有多少个单位正方体？", en: "How many unit cubes are there?" },
        revealPolicy: "after-submit",
        responseFormat: "integer",
        evaluator: { kind: "derived", query: { kind: "voxel.total", entityId: input.entityId } },
      },
    ],
    formulas: [],
    accessibility: {
      summary: { zh: `一个可按 ${layers.length} 层观察和计数的立体图形。`, en: `A solid that can be observed and counted in ${layers.length} layers.` },
      orthographicViews: projections.map((projection) => ({ view: projection.view, summary: projectionSummary(projection) })),
      layerTable: { enabled: true, axis: input.layerAxis },
      measurementTable: true,
      objectDescriptions: [{ entityId: input.entityId, description: { zh: "由若干单位正方体组成。", en: "Made of unit cubes." } }],
      keyboardOrder: [input.entityId],
      colorLegend: [{ materialToken: input.materialToken, label: { zh: "单位正方体", en: "Unit cube" }, pattern: "solid" }],
    },
    provenance: {
      source: { kind: "scratch" },
      createdBy: input.createdBy,
      createdAt: input.createdAt,
      kernelVersion: "voxel-kernel-v1",
      minRuntimeVersion: "1.0.0",
    },
  });

  return {
    adapterVersion: VOXEL_SCENE_ADAPTER_VERSION,
    scene,
    sceneHash: await canonicalSha256(scene),
    totalCount: voxels.size,
    layerCounts,
    projections,
  };
}

/**
 * Materializes the standard authored page used by the editor, preview and later
 * classroom adapters. Spatial voxel pages are 4:3-first; a wide layout is a
 * separate, explicit exception and is intentionally absent from this builder.
 */
export async function buildVoxelCountingPage(inputValue: unknown): Promise<VoxelCountingPageBuildResult> {
  const built = await buildVoxelCountingScene(inputValue);
  const page = await materializeSpatialPageDoc({
    docVersion: SPATIAL_PAGE_DOC_VERSION,
    layout: { profile: "standard-4x3" },
    scene: built.scene,
    source: { kind: "scratch" },
    presentation: {
      viewport: {
        width: 1_200,
        height: 900,
        safeFrame: { x: 0.04, y: 0.04, width: 0.92, height: 0.92 },
      },
      camera: {
        defaultCameraId: "camera.perspective",
        interaction: "orbit",
        transition: "smooth",
        reducedMotion: "jump",
      },
      labelPlacements: [],
      panels: [
        { panelId: "teacher-controls", dock: "bottom", sizePx: 140, initiallyCollapsed: false },
        { panelId: "checkpoint", dock: "right", sizePx: 300, initiallyCollapsed: false },
      ],
    },
    classroom: {
      ownership: {
        defaultMode: "teacher-follow",
        allowedModes: ["teacher-follow", "student-local-explore", "student-submit"],
      },
      cameraSync: "bookmark-and-opt-in-fx",
      durableStatePolicy: "semantic-events-only",
      resetAuthority: "teacher-controller",
      boardPointerPolicy: "mutually-exclusive-tools",
    },
    learningCheck: {
      mode: "formative-only",
      items: [{ checkpointId: "checkpoint.total-count", required: true, evaluation: "server-pinned-kernel" }],
      maxSubmissions: 3,
      responseVisibility: "student-and-authorized-staff",
    },
    fallback: {
      strategy: "scene-accessibility-v1",
      defaultView: "front",
      checkpoints: [{ checkpointId: "checkpoint.total-count", mode: "interactive-2d" }],
      unavailableMessage: {
        zh: "三维画面不可用，已切换到等价二维投影和分层表。",
        en: "The 3D view is unavailable. Equivalent projections and a layer table are shown.",
      },
    },
  });

  return { ...built, page };
}

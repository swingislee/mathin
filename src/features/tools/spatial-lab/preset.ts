import {
  VOXEL_SCENE_ADAPTER_VERSION,
  createDefaultVoxelAuthoringDraft,
  type VoxelAuthoringDraft,
  type VoxelSceneAdapterInput,
} from "@/features/spatial-math/domain";

export const SPATIAL_LAB_PRESET_ID = "spatial-lab.voxel-counting.v1" as const;
export const SPATIAL_LAB_DEFAULT_PRESET_ID = SPATIAL_LAB_PRESET_ID;
export const SPATIAL_LAB_SURFACE_PAINT_PRESET_ID = "spatial-lab.surface-paint.v1" as const;
export const SPATIAL_LAB_HOLLOWING_PRESET_ID = "spatial-lab.hollowing.v1" as const;
export const SPATIAL_LAB_MEASUREMENT_PRESET_ID = "spatial-lab.rectangular-prism-measurement.v1" as const;
export const SPATIAL_LAB_CUBE_NET_FOLD_PRESET_ID = "spatial-lab.cube-net-fold.v1" as const;

export const SPATIAL_LAB_PRESETS = [
  { id: SPATIAL_LAB_PRESET_ID, messageKey: "layeredCounting" },
  { id: "spatial-lab.hidden-cubes.v1", messageKey: "hiddenCubes" },
  { id: "spatial-lab.three-views.v1", messageKey: "threeViews" },
  { id: SPATIAL_LAB_SURFACE_PAINT_PRESET_ID, messageKey: "surfacePainting" },
  { id: SPATIAL_LAB_HOLLOWING_PRESET_ID, messageKey: "hollowing" },
  { id: SPATIAL_LAB_MEASUREMENT_PRESET_ID, messageKey: "volumeSurface" },
] as const;

export type SpatialLabPresetId = (typeof SPATIAL_LAB_PRESETS)[number]["id"];

export const SPATIAL_LAB_ACTIVITIES = [
  ...SPATIAL_LAB_PRESETS.map((preset) => ({ ...preset, kind: "voxel" as const })),
  {
    id: SPATIAL_LAB_CUBE_NET_FOLD_PRESET_ID,
    messageKey: "cubeNetFold",
    kind: "polyhedron-fold" as const,
  },
] as const;

export type SpatialLabActivity = (typeof SPATIAL_LAB_ACTIVITIES)[number];
export type SpatialLabActivityId = SpatialLabActivity["id"];

export function isSpatialLabVoxelPresetId(value: string): value is SpatialLabPresetId {
  return SPATIAL_LAB_PRESETS.some((preset) => preset.id === value);
}

function cellsFromColumns(
  columns: readonly { readonly x: number; readonly z: number; readonly height: number }[],
) {
  return columns
    .flatMap((column) =>
      Array.from({ length: column.height }, (_, y) => ({ x: column.x, y, z: column.z })),
    )
    .sort((left, right) => left.x - right.x || left.y - right.y || left.z - right.z);
}

function presetContent(presetId: SpatialLabPresetId) {
  if (presetId === SPATIAL_LAB_MEASUREMENT_PRESET_ID) {
    return {
      sceneId: "scene.spatial-lab.rectangular-prism-measurement",
      title: { zh: "长方体的体积与表面积", en: "Volume and surface area of a rectangular prism" },
      learningGoal: {
        zh: "让长、宽、高与单位块模型、体积公式和表面积公式同步变化",
        en: "Connect length, width, and height to the unit-cube model, volume, and surface-area formulas",
      },
      teacherPrompt: {
        zh: "先改变一个尺寸，预测体积和表面积会怎样变化，再用单位块与三组相对面验证。",
        en: "Change one dimension, predict how volume and surface area will change, then verify with unit cubes and three pairs of opposite faces.",
      },
      misconception: {
        zh: "把表面积误算成长、宽、高的乘积，或只计算三个面的面积",
        en: "Use the volume product for surface area, or count only three faces",
      },
      cells: cellsFromColumns(
        Array.from({ length: 4 }, (_, x) =>
          Array.from({ length: 3 }, (_, z) => ({ x, z, height: 2 })),
        ).flat(),
      ),
    };
  }
  if (presetId === SPATIAL_LAB_HOLLOWING_PRESET_ID) {
    return {
      sceneId: "scene.spatial-lab.hollowing",
      title: { zh: "挖去与挖空正方体", en: "Carve and hollow a cube" },
      learningGoal: {
        zh: "比较挖去单位块前后的体积、外表面、内表面和空腔",
        en: "Compare volume, exterior area, interior area, and cavities before and after carving",
      },
      teacherPrompt: {
        zh: "切换不同挖法，再隐藏顶层观察内部结构，解释表面积为什么可能增加。",
        en: "Switch carving profiles, hide the top layer to inspect the inside, and explain why surface area can increase.",
      },
      misconception: {
        zh: "认为每挖去一个单位块，表面积都固定减少6",
        en: "Assume removing one unit cube always reduces surface area by six",
      },
      cells: cellsFromColumns(
        Array.from({ length: 3 }, (_, x) =>
          Array.from({ length: 3 }, (_, z) => ({ x, z, height: 3 })),
        ).flat(),
      ),
    };
  }
  if (presetId === SPATIAL_LAB_SURFACE_PAINT_PRESET_ID) {
    return {
      sceneId: "scene.spatial-lab.surface-paint",
      title: { zh: "正方体表面染色", en: "Paint the surface of a cube" },
      learningGoal: {
        zh: "根据外露面数量分类染色后的单位块",
        en: "Classify painted unit cubes by their number of exposed faces",
      },
      teacherPrompt: {
        zh: "点击外露面逐面染色，或一次涂满外表面，再观察角、棱、面心和内部单位块。",
        en: "Paint exposed faces one by one or coat the full exterior, then compare corner, edge, face-center, and interior cubes.",
      },
      misconception: {
        zh: "把被相邻单位块遮住的内部面也算作染色面",
        en: "Count shared internal faces as painted faces",
      },
      cells: cellsFromColumns(
        Array.from({ length: 3 }, (_, x) =>
          Array.from({ length: 3 }, (_, z) => ({ x, z, height: 3 })),
        ).flat(),
      ),
    };
  }
  if (presetId === "spatial-lab.hidden-cubes.v1") {
    return {
      sceneId: "scene.spatial-lab.hidden-cubes",
      title: { zh: "遮挡中的单位正方体", en: "Hidden unit cubes" },
      learningGoal: {
        zh: "结合分层与遮挡关系完整计数",
        en: "Count completely using layers and occlusion",
      },
      teacherPrompt: {
        zh: "先看正面，再转动模型找出每列后面被挡住的单位块。",
        en: "Start from the front, then rotate to find cubes hidden behind each column.",
      },
      misconception: {
        zh: "把正面投影方格数直接当作单位块总数",
        en: "Treat the front projection square count as the total cube count",
      },
      cells: cellsFromColumns([
        { x: 0, z: 0, height: 3 },
        { x: 0, z: 1, height: 3 },
        { x: 1, z: 0, height: 2 },
        { x: 1, z: 1, height: 2 },
        { x: 2, z: 0, height: 2 },
        { x: 2, z: 1, height: 2 },
      ]),
    };
  }
  if (presetId === "spatial-lab.three-views.v1") {
    return {
      sceneId: "scene.spatial-lab.three-views",
      title: { zh: "从三视图观察立体图形", en: "Observe a solid from three views" },
      learningGoal: {
        zh: "比较正面、右面和上面的投影并还原空间结构",
        en: "Compare front, right, and top projections to reconstruct the solid",
      },
      teacherPrompt: {
        zh: "依次观察正面、右面和上面，说一说哪些单位块会互相遮挡。",
        en: "Inspect the front, right, and top views and identify which cubes occlude one another.",
      },
      misconception: {
        zh: "认为一个方向的投影可以唯一确定立体图形",
        en: "Assume one projection uniquely determines the solid",
      },
      cells: cellsFromColumns([
        { x: 0, z: 0, height: 3 },
        { x: 0, z: 1, height: 1 },
        { x: 0, z: 2, height: 2 },
        { x: 1, z: 0, height: 2 },
        { x: 1, z: 1, height: 1 },
        { x: 2, z: 0, height: 1 },
        { x: 2, z: 1, height: 2 },
      ]),
    };
  }
  if (presetId === SPATIAL_LAB_PRESET_ID) {
    return {
      sceneId: "scene.spatial-lab.voxel-counting",
      title: { zh: "分层数单位正方体", en: "Count unit cubes by layer" },
      learningGoal: {
        zh: "结合三视图和分层完整计数",
        en: "Count completely using orthographic views and layers",
      },
      teacherPrompt: {
        zh: "先估一估，再找出可能被挡住的单位块。",
        en: "Estimate first, then find cubes that may be hidden.",
      },
      misconception: {
        zh: "只数正面能看到的单位块",
        en: "Count only cubes visible from the front",
      },
      cells: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 1, z: 1 },
        { x: 0, y: 2, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 0, z: 1 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 0, z: 1 },
      ],
    };
  }
  throw new RangeError(`unknown spatial-lab voxel preset: ${String(presetId)}`);
}

export function createSpatialLabVoxelInput(
  presetId: SpatialLabPresetId = SPATIAL_LAB_DEFAULT_PRESET_ID,
): VoxelSceneAdapterInput {
  const content = presetContent(presetId);
  return {
    adapterVersion: VOXEL_SCENE_ADAPTER_VERSION,
    sceneId: content.sceneId,
    entityId: "voxel.main",
    title: content.title,
    learningGoal: content.learningGoal,
    teacherPrompt: content.teacherPrompt,
    misconception: content.misconception,
    cells: content.cells,
    layerAxis: "y",
    materialToken: "voxel.base",
    termIds: presetId === SPATIAL_LAB_MEASUREMENT_PRESET_ID
      ? ["rectangular-prism-and-cube", "surface-area", "volume-and-capacity"]
      : ["solid-figures", "views-of-objects"],
    prerequisiteTermIds: ["solid-figures"],
    createdBy: "spatial-lab.prototype",
    createdAt: "2026-08-12T00:00:00+08:00",
  };
}

export function createSpatialLabInitialDraft(): VoxelAuthoringDraft {
  return createSpatialLabPresetDraft(SPATIAL_LAB_DEFAULT_PRESET_ID);
}

export function createSpatialLabPresetDraft(presetId: SpatialLabPresetId): VoxelAuthoringDraft {
  return createDefaultVoxelAuthoringDraft(createSpatialLabVoxelInput(presetId));
}

import {
  VOXEL_SCENE_ADAPTER_VERSION,
  createDefaultVoxelAuthoringDraft,
  type VoxelAuthoringDraft,
  type VoxelSceneAdapterInput,
} from "@/features/spatial-math/domain";

export const SPATIAL_LAB_PRESET_ID = "spatial-lab.voxel-counting.v1" as const;
export const SPATIAL_LAB_DEFAULT_PRESET_ID = SPATIAL_LAB_PRESET_ID;

export const SPATIAL_LAB_PRESETS = [
  { id: SPATIAL_LAB_PRESET_ID, messageKey: "layeredCounting" },
  { id: "spatial-lab.hidden-cubes.v1", messageKey: "hiddenCubes" },
  { id: "spatial-lab.three-views.v1", messageKey: "threeViews" },
] as const;

export type SpatialLabPresetId = (typeof SPATIAL_LAB_PRESETS)[number]["id"];

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
    termIds: ["solid-figures", "views-of-objects"],
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

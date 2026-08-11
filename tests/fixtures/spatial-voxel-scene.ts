import {
  VOXEL_SCENE_ADAPTER_VERSION,
  buildVoxelCountingPage,
  type SpatialPageDoc,
  type VoxelSceneAdapterInput,
} from "@/features/spatial-math/domain";

export function voxelCountingAdapterInput(): VoxelSceneAdapterInput {
  return {
    adapterVersion: VOXEL_SCENE_ADAPTER_VERSION,
    sceneId: "scene.voxel-counting.001",
    entityId: "voxel.main",
    title: { zh: "分层数单位正方体", en: "Count unit cubes by layer" },
    learningGoal: { zh: "结合三视图和分层完整计数", en: "Count completely using views and layers" },
    teacherPrompt: { zh: "先估一估，再找出可能被挡住的单位块。", en: "Estimate first, then find cubes that may be hidden." },
    misconception: { zh: "只数正面能看到的单位块", en: "Count only cubes visible from the front" },
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
    layerAxis: "y",
    materialToken: "voxel.base",
    termIds: ["solid-figures", "views-of-objects"],
    prerequisiteTermIds: ["solid-figures"],
    createdBy: "00000000-0000-4000-8000-000000000001",
    createdAt: "2026-08-12T00:00:00+08:00",
  };
}

export async function voxelCountingSpatialPage(): Promise<SpatialPageDoc> {
  return (await buildVoxelCountingPage(voxelCountingAdapterInput())).page;
}

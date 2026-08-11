import {
  SPATIAL_PAGE_DOC_VERSION,
  VOXEL_SCENE_ADAPTER_VERSION,
  buildVoxelCountingScene,
  materializeSpatialPageDoc,
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
  const built = await buildVoxelCountingScene(voxelCountingAdapterInput());
  return materializeSpatialPageDoc({
    docVersion: SPATIAL_PAGE_DOC_VERSION,
    layout: { profile: "standard-4x3" },
    scene: built.scene,
    source: { kind: "scratch" },
    presentation: {
      viewport: { width: 1_200, height: 900, safeFrame: { x: 0.04, y: 0.04, width: 0.92, height: 0.92 } },
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
}

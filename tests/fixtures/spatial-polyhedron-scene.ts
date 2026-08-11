import {
  POLYHEDRON_FOLD_SIMULATION_VERSION,
  POLYHEDRON_SCENE_ADAPTER_VERSION,
  SPATIAL_PAGE_DOC_VERSION,
  buildPolyhedronFoldScene,
  materializeSpatialPageDoc,
  rational,
  type PolyhedronSceneAdapterInput,
  type SpatialPageDoc,
} from "@/features/spatial-math/domain";
import {
  cubeGeometry,
  cubeHingeGraph,
  cubeTopology,
  cubeUnitNetLayout,
} from "./spatial-polyhedron-cube";

export function cubeFoldSceneAdapterInput(): PolyhedronSceneAdapterInput {
  return {
    adapterVersion: POLYHEDRON_SCENE_ADAPTER_VERSION,
    sceneId: "scene.cube-net.001",
    entityId: "polyhedron.cube",
    title: { zh: "正方体展开与折叠", en: "Cube nets and folding" },
    entityLabel: { zh: "正方体", en: "Cube" },
    localePolicy: "bilingual",
    learning: {
      learningGoal: { zh: "通过折叠判断正方体的相对面", en: "Identify opposite cube faces by folding a net" },
      termIds: ["nets-of-solids", "solid-figures"],
      prerequisiteTermIds: ["solid-figures"],
      misconceptions: [
        { zh: "把展开图中相隔最远的面直接当作相对面", en: "Assuming the farthest net faces are opposite" },
      ],
      teacherPrompts: [
        { zh: "先预测，再折到一半验证方向。", en: "Predict first, then fold halfway to check direction." },
      ],
    },
    appearance: { materialToken: "solid.primary", background: "paper", lighting: "flat" },
    space: { unit: "unit", gridStep: rational(1) },
    topology: cubeTopology(),
    geometry: cubeGeometry(),
    hingeGraph: cubeHingeGraph(),
    layout: cubeUnitNetLayout(),
    simulationRequest: {
      simulationVersion: POLYHEDRON_FOLD_SIMULATION_VERSION,
      sampleProgressMillionths: [0, 250_000, 500_000, 750_000, 1_000_000],
      closureToleranceMicrounits: 5,
    },
    faceLabels: [
      { faceId: "face.x.neg", label: { zh: "左面", en: "Left" } },
      { faceId: "face.x.pos", label: { zh: "右面", en: "Right" } },
      { faceId: "face.y.neg", label: { zh: "下面", en: "Bottom" } },
      { faceId: "face.y.pos", label: { zh: "上面", en: "Top" } },
      { faceId: "face.z.neg", label: { zh: "后面", en: "Back" } },
      { faceId: "face.z.pos", label: { zh: "前面", en: "Front" } },
    ],
    teaching: {
      referenceFaceId: "face.z.pos",
      optionFaceIds: ["face.x.neg", "face.x.pos", "face.z.neg"],
      checkpointId: "checkpoint.opposite-face",
      checkpointPrompt: { zh: "哪个面与前面相对？", en: "Which face is opposite the front face?" },
      revealPolicy: "teacher",
      fallbackSummary: {
        zh: "二维展开图由六个正方形组成；前面沿四条铰链连接四个侧面，后面连接在右面外侧。",
        en: "The planar net has six squares; four side faces hinge around the front face and the back attaches beyond the right face.",
      },
      orthographicSummaries: {
        front: { zh: "折叠后正面是一个正方形。", en: "The folded front view is one square." },
        right: { zh: "折叠后右面是一个正方形。", en: "The folded right view is one square." },
        top: { zh: "折叠后上面是一个正方形。", en: "The folded top view is one square." },
      },
    },
    provenance: {
      source: { kind: "scratch" },
      createdBy: "00000000-0000-4000-8000-000000000001",
      createdAt: "2026-08-11T22:00:00+08:00",
      minRuntimeVersion: "1.0.0",
    },
  };
}

export async function cubeFoldSpatialPage(): Promise<SpatialPageDoc> {
  const built = await buildPolyhedronFoldScene(cubeFoldSceneAdapterInput());
  return materializeSpatialPageDoc({
    docVersion: SPATIAL_PAGE_DOC_VERSION,
    layout: { profile: "standard-4x3" },
    scene: built.scene,
    source: { kind: "scratch" },
    presentation: {
      viewport: { width: 1_200, height: 900, safeFrame: { x: 0.04, y: 0.04, width: 0.92, height: 0.92 } },
      camera: {
        defaultCameraId: "camera.front",
        interaction: "orbit",
        transition: "smooth",
        reducedMotion: "jump",
      },
      labelPlacements: [],
      panels: [],
    },
    classroom: {
      ownership: {
        defaultMode: "teacher-follow",
        allowedModes: ["teacher-follow", "student-local-explore", "student-submit"],
      },
      cameraSync: "bookmark-only",
      durableStatePolicy: "semantic-events-only",
      resetAuthority: "teacher-controller",
      boardPointerPolicy: "mutually-exclusive-tools",
    },
    learningCheck: {
      mode: "formative-only",
      items: [{ checkpointId: "checkpoint.opposite-face", required: true, evaluation: "server-pinned-kernel" }],
      maxSubmissions: 2,
      responseVisibility: "student-and-authorized-staff",
    },
    fallback: {
      strategy: "scene-accessibility-v1",
      defaultView: "front",
      checkpoints: [{ checkpointId: "checkpoint.opposite-face", mode: "interactive-2d" }],
      unavailableMessage: { zh: "三维不可用时使用二维展开图。", en: "Use the planar net when 3D is unavailable." },
    },
  });
}

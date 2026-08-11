import {
  SPATIAL_PAGE_DOC_VERSION,
  materializeSpatialPageDoc,
  parseSpatialPageDoc,
  rational,
  type SpatialPageDoc,
  type SpatialPageDocDraft,
  type SpatialScene,
} from "@/features/spatial-math/domain";

const ZERO = rational(0);
const ONE = rational(1);

export function validSpatialScene(): SpatialScene {
  return {
    schemaVersion: "spatial-scene-v1",
    sceneId: "scene.page-contract.001",
    title: { zh: "分层观察", en: "Observe by layer" },
    localePolicy: "bilingual",
    learning: {
      capability: "P2",
      learningGoal: { zh: "通过分层观察确定单位正方体数量", en: "Count unit cubes layer by layer" },
      termIds: ["solid-figures", "views-of-objects"],
      prerequisiteTermIds: ["solid-figures"],
      misconceptions: [{ zh: "只数看得见的正方体", en: "Count only visible cubes" }],
      teacherPrompts: [{ zh: "先预测，再逐层验证", en: "Predict, then verify layer by layer" }],
    },
    space: { coordinateSystem: "right-handed-y-up", unit: "unit", gridStep: ONE },
    model: {
      entities: [
        {
          id: "label.question",
          type: "label",
          visible: true,
          anchor: { x: ZERO, y: ONE, z: ZERO },
          text: { zh: "一共有多少个？", en: "How many are there?" },
        },
        {
          id: "voxel.main",
          type: "voxel-set",
          visible: true,
          materialToken: "voxel.base",
          cells: [{ id: "cell.0.0.0", x: 0, y: 0, z: 0 }],
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
        {
          id: "camera.front",
          label: { zh: "正面", en: "Front" },
          projection: "orthographic",
          position: { x: 0, y: 1, z: 8 },
          target: { x: 0, y: 0, z: 0 },
          up: { x: 0, y: 1, z: 0 },
          zoom: 1,
        },
      ],
      defaultCameraId: "camera.front",
      layers: [],
    },
    sequence: { steps: [] },
    checkpoints: [
      {
        id: "checkpoint.count",
        type: "numeric",
        prompt: { zh: "一共有多少个单位正方体？", en: "How many unit cubes are there?" },
        revealPolicy: "after-submit",
        responseFormat: "integer",
        evaluator: { kind: "derived", query: { kind: "voxel.total", entityId: "voxel.main" } },
      },
      {
        id: "checkpoint.explain",
        type: "explanation",
        prompt: { zh: "说明你的计数方法", en: "Explain how you counted" },
        revealPolicy: "teacher",
        minLength: 1,
        maxLength: 500,
      },
    ],
    formulas: [],
    accessibility: {
      summary: { zh: "一个单位正方体和一道计数问题", en: "One unit cube and a counting question" },
      orthographicViews: [
        { view: "front", summary: { zh: "正面看到一个方格", en: "One square from the front" } },
        { view: "right", summary: { zh: "右面看到一个方格", en: "One square from the right" } },
        { view: "top", summary: { zh: "上面看到一个方格", en: "One square from the top" } },
      ],
      layerTable: { enabled: true, axis: "y" },
      measurementTable: true,
      objectDescriptions: [
        { entityId: "label.question", description: { zh: "计数问题", en: "Counting question" } },
        { entityId: "voxel.main", description: { zh: "一个单位正方体", en: "One unit cube" } },
      ],
      keyboardOrder: ["voxel.main", "label.question"],
      colorLegend: [
        {
          materialToken: "voxel.base",
          label: { zh: "普通单位正方体", en: "Regular unit cube" },
          pattern: "solid",
        },
      ],
    },
    provenance: {
      source: { kind: "scratch" },
      createdBy: "00000000-0000-4000-8000-000000000001",
      createdAt: "2026-08-11T12:00:00+08:00",
      kernelVersion: "voxel-kernel-v1",
      minRuntimeVersion: "1.0.0",
    },
  };
}

export function standardSpatialPageDraft(scene = validSpatialScene()): SpatialPageDocDraft {
  return {
    docVersion: SPATIAL_PAGE_DOC_VERSION,
    layout: { profile: "standard-4x3" },
    scene,
    source: { kind: "scratch" },
    presentation: {
      viewport: { width: 1_200, height: 900, safeFrame: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 } },
      camera: {
        defaultCameraId: "camera.front",
        interaction: "orbit",
        transition: "smooth",
        reducedMotion: "jump",
      },
      labelPlacements: [
        {
          entityId: "label.question",
          offsetPx: { x: 0, y: -24 },
          maxWidthPx: 360,
          collision: "nudge",
        },
      ],
      panels: [
        { panelId: "teacher-controls", dock: "bottom", sizePx: 160, initiallyCollapsed: false },
        { panelId: "checkpoint", dock: "right", sizePx: 320, initiallyCollapsed: true },
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
      items: [
        { checkpointId: "checkpoint.count", required: true, evaluation: "server-pinned-kernel" },
        { checkpointId: "checkpoint.explain", required: false, evaluation: "collect-evidence" },
      ],
      maxSubmissions: 3,
      responseVisibility: "student-and-authorized-staff",
    },
    fallback: {
      strategy: "scene-accessibility-v1",
      defaultView: "front",
      checkpoints: [
        { checkpointId: "checkpoint.count", mode: "interactive-2d" },
        { checkpointId: "checkpoint.explain", mode: "interactive-2d" },
      ],
      unavailableMessage: {
        zh: "三维画面不可用，已切换到等价二维视图。",
        en: "The 3D view is unavailable. An equivalent 2D view is shown.",
      },
    },
  };
}

export async function validStandardSpatialPage(): Promise<SpatialPageDoc> {
  return materializeSpatialPageDoc(standardSpatialPageDraft());
}

export function wideSpatialPageFrom(standard: SpatialPageDoc): SpatialPageDoc {
  return parseSpatialPageDoc({
    ...structuredClone(standard),
    layout: {
      profile: "wide-16x9-exception",
      reason: {
        zh: "需要并排展示三个正投影视图",
        en: "The activity needs three orthographic views side by side",
      },
    },
    presentation: {
      ...structuredClone(standard.presentation),
      viewport: { width: 1_600, height: 900, safeFrame: { x: 0.04, y: 0.04, width: 0.92, height: 0.92 } },
      panels: [
        { panelId: "teacher-controls", dock: "bottom", sizePx: 140, initiallyCollapsed: false },
        { panelId: "checkpoint", dock: "left", sizePx: 280, initiallyCollapsed: true },
      ],
    },
  });
}

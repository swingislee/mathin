import { describe, expect, it } from "vitest";
import { coursewareDocSchema } from "@/features/courseware-doc/document";
import {
  SPATIAL_PAGE_DOC_VERSION,
  SPATIAL_PAGE_ERROR_CODES,
  canonicalSha256,
  materializeSpatialPageDoc,
  parseSpatialPageDoc,
  rational,
  spatialPageDocSchema,
  verifySpatialPageDoc,
  verifySpatialPageLayoutSet,
  type SpatialPageDoc,
  type SpatialPageDocDraft,
  type SpatialScene,
} from "@/features/spatial-math/domain";

const ZERO = rational(0);
const ONE = rational(1);

function validScene(): SpatialScene {
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

function standardDraft(scene = validScene()): SpatialPageDocDraft {
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

async function validStandardPage(): Promise<SpatialPageDoc> {
  return materializeSpatialPageDoc(standardDraft());
}

function wideFrom(standard: SpatialPageDoc): SpatialPageDoc {
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

describe("spatial-page-v1 structure", () => {
  it("materializes and verifies a strict page without enabling the production CoursewareDoc union", async () => {
    const page = await validStandardPage();

    expect(page.docVersion).toBe(SPATIAL_PAGE_DOC_VERSION);
    expect(page.sceneHash).toBe(await canonicalSha256(page.scene));
    await expect(verifySpatialPageDoc(page)).resolves.toEqual(page);
    expect(coursewareDocSchema.safeParse(page).success).toBe(false);
  });

  it("rejects unknown fields, a wrong layout ratio, an unknown camera and a non-label placement", async () => {
    const page = await validStandardPage();
    const unknown = { ...page, executable: "alert(1)" };
    const ratio = structuredClone(page);
    ratio.presentation.viewport.width = 1_600;
    const camera = structuredClone(page);
    camera.presentation.camera.defaultCameraId = "camera.missing";
    const label = structuredClone(page);
    label.presentation.labelPlacements[0].entityId = "voxel.main";

    expect(spatialPageDocSchema.safeParse(unknown).success).toBe(false);
    expect(spatialPageDocSchema.safeParse(ratio).success).toBe(false);
    expect(spatialPageDocSchema.safeParse(camera).success).toBe(false);
    expect(spatialPageDocSchema.safeParse(label).success).toBe(false);
  });

  it("keeps ownership, learning checks and fallback coverage consistent", async () => {
    const page = await validStandardPage();
    const defaultMode = structuredClone(page);
    defaultMode.classroom.ownership.allowedModes = ["student-local-explore", "student-submit"];
    const disabled = structuredClone(page) as SpatialPageDoc;
    disabled.learningCheck = { mode: "disabled" };
    const explanation = structuredClone(page);
    if (explanation.learningCheck.mode !== "formative-only") throw new Error("fixture learning check mismatch");
    explanation.learningCheck.items[1].evaluation = "server-pinned-kernel";
    const fallback = structuredClone(page);
    fallback.fallback.checkpoints.pop();

    expect(spatialPageDocSchema.safeParse(defaultMode).success).toBe(false);
    expect(spatialPageDocSchema.safeParse(disabled).success).toBe(false);
    expect(spatialPageDocSchema.safeParse(explanation).success).toBe(false);
    expect(spatialPageDocSchema.safeParse(fallback).success).toBe(false);
  });

  it("requires page source metadata to match scene provenance", async () => {
    const page = await validStandardPage();
    const sourceMismatch = structuredClone(page);
    sourceMismatch.source = {
      kind: "preset-release",
      presetId: "preset.layer-count",
      releaseNo: 1,
      sourceSceneHash: "a".repeat(64),
    };

    expect(spatialPageDocSchema.safeParse(sourceMismatch).success).toBe(false);
  });

  it("detects a structurally valid but forged scene hash", async () => {
    const page = await validStandardPage();
    const forged = { ...page, sceneHash: "0".repeat(64) };

    expect(spatialPageDocSchema.safeParse(forged).success).toBe(true);
    await expect(verifySpatialPageDoc(forged)).rejects.toMatchObject({
      code: SPATIAL_PAGE_ERROR_CODES.sceneHashMismatch,
    });
  });
});

describe("spatial-page-v1 4:3-first layout set", () => {
  it("accepts a standard 4:3 page without requiring a second authored layout", async () => {
    const standard = await validStandardPage();

    await expect(verifySpatialPageLayoutSet(standard)).resolves.toEqual({ standard });
  });

  it("allows an explicitly justified wide exception to differ only in presentation", async () => {
    const standard = await validStandardPage();
    const wide = wideFrom(standard);

    await expect(verifySpatialPageLayoutSet(standard, wide)).resolves.toEqual({ standard, wide });
  });

  it("rejects a missing wide-screen exception reason", async () => {
    const standard = await validStandardPage();
    const wideWithoutReason = {
      ...wideFrom(standard),
      layout: { profile: "wide-16x9-exception" },
    };

    expect(spatialPageDocSchema.safeParse(wideWithoutReason).success).toBe(false);
  });

  it("rejects duplicate/reversed layout profiles with a stable error code", async () => {
    const standard = await validStandardPage();

    await expect(verifySpatialPageLayoutSet(standard, standard)).rejects.toMatchObject({
      code: SPATIAL_PAGE_ERROR_CODES.layoutSetOrder,
    });
  });

  it("rejects semantic policy or scene drift between layout variants", async () => {
    const standard = await validStandardPage();
    const policyDrift = wideFrom(standard);
    policyDrift.classroom.cameraSync = "bookmark-only";

    const changedScene = structuredClone(standard.scene);
    changedScene.title.zh = "另一份场景";
    const sceneDrift = await materializeSpatialPageDoc({
      ...standardDraft(changedScene),
      layout: wideFrom(standard).layout,
      presentation: wideFrom(standard).presentation,
    });

    await expect(verifySpatialPageLayoutSet(standard, policyDrift)).rejects.toMatchObject({
      code: SPATIAL_PAGE_ERROR_CODES.layoutSetMismatch,
    });
    await expect(verifySpatialPageLayoutSet(standard, sceneDrift)).rejects.toMatchObject({
      code: SPATIAL_PAGE_ERROR_CODES.layoutSetMismatch,
    });
  });
});

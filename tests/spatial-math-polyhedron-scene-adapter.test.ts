import { describe, expect, it } from "vitest";
import { coursewareDocSchema } from "@/features/courseware-doc/document";
import {
  POLYHEDRON_FOLD_SIMULATION_VERSION,
  POLYHEDRON_SCENE_ADAPTER_ERROR_CODES,
  POLYHEDRON_SCENE_ADAPTER_VERSION,
  SPATIAL_PAGE_DOC_VERSION,
  buildPolyhedronFoldScene,
  canonicalSha256,
  createInitialSpatialRuntimeState,
  materializeSpatialPageDoc,
  parsePolyhedronFoldArtifact,
  parsePolyhedronSceneAdapterInput,
  parseSpatialScene,
  rational,
  resolvePolyhedronFoldFrameFromScene,
} from "@/features/spatial-math/domain";
import {
  cubeGeometry,
  cubeHingeGraph,
  cubeTopology,
  cubeUnitNetLayout,
} from "./fixtures/spatial-polyhedron-cube";

function adapterInput() {
  return {
    adapterVersion: POLYHEDRON_SCENE_ADAPTER_VERSION,
    sceneId: "scene.cube-net.001",
    entityId: "polyhedron.cube",
    title: { zh: "正方体展开与折叠", en: "Cube nets and folding" },
    entityLabel: { zh: "正方体", en: "Cube" },
    localePolicy: "bilingual" as const,
    learning: {
      learningGoal: { zh: "通过折叠判断正方体的相对面", en: "Identify opposite cube faces by folding a net" },
      termIds: ["nets-of-solids", "solid-figures"],
      prerequisiteTermIds: ["solid-figures"],
      misconceptions: [{ zh: "把展开图中相隔最远的面直接当作相对面", en: "Assuming the farthest net faces are opposite" }],
      teacherPrompts: [{ zh: "先预测，再折到一半验证方向。", en: "Predict first, then fold halfway to check direction." }],
    },
    appearance: { materialToken: "solid.primary", background: "paper" as const, lighting: "flat" as const },
    space: { unit: "unit" as const, gridStep: rational(1) },
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
      revealPolicy: "teacher" as const,
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
      source: { kind: "scratch" as const },
      createdBy: "00000000-0000-4000-8000-000000000001",
      createdAt: "2026-08-11T22:00:00+08:00",
      minRuntimeVersion: "1.0.0",
    },
  };
}

describe("polyhedron-scene-adapter-v1", () => {
  it("materializes one self-contained fold artifact, teaching sequence, checkpoint and 2D fallback", async () => {
    const result = await buildPolyhedronFoldScene(adapterInput());
    const entity = result.scene.model.entities[0];

    expect(parseSpatialScene(result.scene)).toEqual(result.scene);
    expect(result.sceneHash).toBe(await canonicalSha256(result.scene));
    expect(result.scene.learning.capability).toBe("P4");
    expect(entity).toMatchObject({ id: "polyhedron.cube", type: "polyhedron" });
    expect(entity.type === "polyhedron" && entity.folding?.artifactVersion).toBe("polyhedron-fold-artifact-v1");
    expect(result.folding.validation.passesSampledValidation).toBe(true);
    expect(result.folding.validation.finalClosure.maximumVertexErrorMicrounits).toBe(0);
    expect(result.folding.fallback.faceLabels).toHaveLength(6);
    expect(result.folding.fallback.foldOrderEdgeIds).toHaveLength(5);
    expect(result.scene.sequence.steps.flatMap((step) => step.actions).filter((action) => action.kind === "net.foldTo")).toEqual([
      { kind: "net.foldTo", entityId: "polyhedron.cube", progress: 0 },
      { kind: "net.foldTo", entityId: "polyhedron.cube", progress: 0.5 },
      { kind: "net.foldTo", entityId: "polyhedron.cube", progress: 1 },
    ]);
    expect(result.scene.checkpoints[0]).toMatchObject({
      id: "checkpoint.opposite-face",
      type: "choice",
      correctOptionIds: ["face.z.neg"],
    });
  });

  it("is hash-stable and resolves runtime progress back into deterministic fold frames", async () => {
    const first = await buildPolyhedronFoldScene(adapterInput());
    const second = await buildPolyhedronFoldScene(adapterInput());

    expect(first).toEqual(second);
    const half = resolvePolyhedronFoldFrameFromScene(first.scene, "polyhedron.cube", 0.5);
    const final = resolvePolyhedronFoldFrameFromScene(first.scene, "polyhedron.cube", 1);
    expect(half.progressMillionths).toBe(500_000);
    expect(final.progressMillionths).toBe(1_000_000);
    expect(final.collisionPairs).toEqual([]);
    expect(() => resolvePolyhedronFoldFrameFromScene(first.scene, "polyhedron.cube", 1.01)).toThrow(RangeError);
    expect(() => resolvePolyhedronFoldFrameFromScene(first.scene, "missing", 0.5)).toThrow(
      expect.objectContaining({ code: POLYHEDRON_SCENE_ADAPTER_ERROR_CODES.entityNotFoldable }),
    );
  });

  it("fits the existing 4:3 page and runtime contracts without enabling the production doc union", async () => {
    const built = await buildPolyhedronFoldScene(adapterInput());
    const page = await materializeSpatialPageDoc({
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
    const state = createInitialSpatialRuntimeState(page);

    expect(page.layout.profile).toBe("standard-4x3");
    expect(page.presentation.viewport).toMatchObject({ width: 1_200, height: 900 });
    expect(state.netFoldProgress).toEqual([{ entityId: "polyhedron.cube", progress: 0 }]);
    expect(coursewareDocSchema.safeParse(page).success).toBe(false);
  });

  it("rejects scene/artifact drift, incomplete face metadata and invalid authored folds", async () => {
    const built = await buildPolyhedronFoldScene(adapterInput());
    const drifted = structuredClone(built.scene);
    const entity = drifted.model.entities[0];
    if (entity.type !== "polyhedron") throw new Error("fixture entity mismatch");
    entity.vertices[0].position.x = rational(2);
    expect(() => parseSpatialScene(drifted)).toThrow(/must match folding geometry/);

    const artifactDrift = structuredClone(built.folding);
    artifactDrift.fallback.foldOrderEdgeIds = [...artifactDrift.fallback.foldOrderEdgeIds].reverse();
    expect(() => parsePolyhedronFoldArtifact(artifactDrift)).toThrow(/fold order/);

    const missingLabel = adapterInput();
    missingLabel.faceLabels = missingLabel.faceLabels.slice(1);
    await expect(buildPolyhedronFoldScene(missingLabel)).rejects.toMatchObject({
      code: POLYHEDRON_SCENE_ADAPTER_ERROR_CODES.faceLabelCoverage,
    });

    const wrongOptions = adapterInput();
    wrongOptions.teaching.optionFaceIds = ["face.x.neg", "face.x.pos", "face.y.neg"];
    await expect(buildPolyhedronFoldScene(wrongOptions)).rejects.toMatchObject({
      code: POLYHEDRON_SCENE_ADAPTER_ERROR_CODES.optionFaceInvalid,
    });

    const invalidFold = adapterInput();
    invalidFold.hingeGraph = cubeHingeGraph({ allValley: true });
    await expect(buildPolyhedronFoldScene(invalidFold)).rejects.toMatchObject({
      code: POLYHEDRON_SCENE_ADAPTER_ERROR_CODES.simulationInvalid,
    });
  });

  it("keeps adapter inputs strict and stably ordered", () => {
    const valid = adapterInput();
    expect(parsePolyhedronSceneAdapterInput(valid)).toEqual(valid);
    expect(() => parsePolyhedronSceneAdapterInput({ ...valid, executable: "alert(1)" })).toThrow();
    expect(() =>
      parsePolyhedronSceneAdapterInput({ ...valid, faceLabels: [...valid.faceLabels].reverse() }),
    ).toThrow();
    expect(() =>
      parsePolyhedronSceneAdapterInput({
        ...valid,
        teaching: { ...valid.teaching, optionFaceIds: [...valid.teaching.optionFaceIds].reverse() },
      }),
    ).toThrow();
  });
});

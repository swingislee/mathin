import { describe, expect, it } from "vitest";
import { coursewareDocSchema } from "@/features/courseware-doc/document";
import {
  POLYHEDRON_SCENE_ADAPTER_ERROR_CODES,
  buildPolyhedronFoldScene,
  canonicalSha256,
  createInitialSpatialRuntimeState,
  parsePolyhedronFoldArtifact,
  parsePolyhedronSceneAdapterInput,
  parseSpatialScene,
  rational,
  resolvePolyhedronFoldFrameFromScene,
} from "@/features/spatial-math/domain";
import { cubeHingeGraph } from "./fixtures/spatial-polyhedron-cube";
import { cubeFoldSceneAdapterInput, cubeFoldSpatialPage } from "./fixtures/spatial-polyhedron-scene";

const adapterInput = cubeFoldSceneAdapterInput;

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
    const page = await cubeFoldSpatialPage();
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

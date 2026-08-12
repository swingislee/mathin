import { beforeAll, describe, expect, it } from "vitest";
import {
  CUBE_NET_ANALYSIS_REASONS,
  CUBE_NET_FOLDING_PRESET_ID,
  CUBE_NET_FOLDING_PRESET_VERSION,
  buildCubeNetFoldingPreset,
  canonicalSha256,
  createCubeNetFoldingPresetRequest,
  createCubeNetFoldingSceneInput,
  createInitialSpatialRuntimeState,
  parseCubeNetFoldingPresetRequest,
  resolvePolyhedronFoldFrameFromScene,
  unitSquareNetCanonicalKey,
  type CubeNetFoldingPresetBuild,
} from "@/features/spatial-math/domain";

describe("cube-net-folding-preset-v1", () => {
  let built: CubeNetFoldingPresetBuild;

  beforeAll(async () => {
    built = await buildCubeNetFoldingPreset(createCubeNetFoldingPresetRequest());
  });

  it("accepts only the strict fixed preset request", () => {
    const request = createCubeNetFoldingPresetRequest();
    expect(request).toEqual({
      presetVersion: CUBE_NET_FOLDING_PRESET_VERSION,
      presetId: CUBE_NET_FOLDING_PRESET_ID,
    });
    expect(parseCubeNetFoldingPresetRequest(request)).toEqual(request);
    expect(() => parseCubeNetFoldingPresetRequest({ ...request, unexpected: true })).toThrow();
    expect(() => parseCubeNetFoldingPresetRequest({ ...request, presetVersion: "v2" })).toThrow();
    expect(() => parseCubeNetFoldingPresetRequest({ ...request, presetId: "cube-net.other" })).toThrow();
    expect(() => createCubeNetFoldingSceneInput({ presetVersion: request.presetVersion })).toThrow();
  });

  it("derives one legal six-square cube net and all six semantic faces", () => {
    expect(built.net.cells).toEqual([
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
    expect(built.analysis).toMatchObject({
      connected: true,
      isCubeNet: true,
      reason: CUBE_NET_ANALYSIS_REASONS.valid,
      cellCount: 6,
      adjacencyEdgeCount: 5,
    });
    expect(built.analysis.canonicalKey).toBe(unitSquareNetCanonicalKey(built.net));
    expect(built.analysis.faces).toHaveLength(6);
    expect([...new Set(built.analysis.faces.map((face) => face.cubeFace))].sort()).toEqual([
      "x+",
      "x-",
      "y+",
      "y-",
      "z+",
      "z-",
    ]);
  });

  it("materializes a validated five-hinge fold artifact with bilingual fallback", () => {
    const folding = built.sceneBuild.folding;
    expect(folding.hingeGraph.hinges).toHaveLength(5);
    expect(folding.layout.foldTargets).toHaveLength(5);
    expect(folding.validation).toMatchObject({
      passesSampledValidation: true,
      collisionEvidence: "deterministic-samples-only",
      finalClosure: {
        toleranceMicrounits: 5,
        maximumVertexErrorMicrounits: 0,
      },
    });
    expect(folding.validation.targetAngles).toHaveLength(5);
    expect(folding.fallback.foldOrderEdgeIds).toHaveLength(5);
    expect(folding.fallback.faceLabels).toHaveLength(6);
    expect(folding.fallback.summary.zh).toContain("六个正方形");
    expect(folding.fallback.summary.en).toContain("six squares");
    expect(
      Object.fromEntries(
        folding.fallback.faceLabels.map(({ faceId, label }) => [faceId, label.zh]),
      ),
    ).toEqual({
      "face.x.neg": "B",
      "face.x.pos": "C",
      "face.y.neg": "D",
      "face.y.pos": "E",
      "face.z.neg": "F",
      "face.z.pos": "A",
    });
    expect(
      folding.fallback.faceLabels.every(
        ({ label }) => label.zh.length > 0 && Boolean(label.en && label.en.length > 0),
      ),
    ).toBe(true);
    expect(built.sceneBuild.scene.checkpoints[0]).toMatchObject({
      prompt: { zh: "哪个面与 A 面相对？", en: "Which face is opposite face A?" },
      options: [
        { id: "face.x.neg", label: { zh: "B", en: "B" } },
        { id: "face.x.pos", label: { zh: "C", en: "C" } },
        { id: "face.z.neg", label: { zh: "F", en: "F" } },
      ],
      correctOptionIds: ["face.z.neg"],
    });
  });

  it("keeps the scene and page hashes deterministic", async () => {
    const second = await buildCubeNetFoldingPreset(createCubeNetFoldingPresetRequest());
    expect(second).toEqual(built);
    expect(built.sceneBuild.sceneHash).toBe(await canonicalSha256(built.sceneBuild.scene));
    expect(await canonicalSha256(second.page)).toBe(await canonicalSha256(built.page));
  });

  it("resolves deterministic open, half-folded, and closed frames", () => {
    const frames = [0, 0.5, 1].map((progress) =>
      resolvePolyhedronFoldFrameFromScene(
        built.sceneBuild.scene,
        built.sceneInput.entityId,
        progress,
      ),
    );
    expect(frames.map((frame) => frame.progressMillionths)).toEqual([0, 500_000, 1_000_000]);
    expect(frames.every((frame) => frame.faces.length === 6)).toBe(true);
    expect(frames.every((frame) => frame.collisionPairs.length === 0)).toBe(true);
    expect(
      resolvePolyhedronFoldFrameFromScene(
        built.sceneBuild.scene,
        built.sceneInput.entityId,
        0.5,
      ),
    ).toEqual(frames[1]);
    expect(built.sceneBuild.folding.validation.finalClosure.maximumVertexErrorMicrounits).toBe(0);
  });

  it("builds only the 1200 by 900 standard 4:3 scratch page", () => {
    expect(built.page.layout).toEqual({ profile: "standard-4x3" });
    expect(built.page.presentation.viewport).toMatchObject({ width: 1_200, height: 900 });
    expect(built.page.source).toEqual({ kind: "scratch" });
    expect(built.page.sceneHash).toBe(built.sceneBuild.sceneHash);
    expect(createInitialSpatialRuntimeState(built.page).netFoldProgress).toEqual([
      { entityId: built.sceneInput.entityId, progress: 0 },
    ]);
  });
});

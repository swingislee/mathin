import { describe, expect, it } from "vitest";
import {
  SPATIAL_SCENE_LIMITS,
  buildVoxelCountingScene,
  canonicalSha256,
  parseVoxelSceneAdapterInput,
} from "@/features/spatial-math/domain";
import { voxelCountingAdapterInput, voxelCountingSpatialPage } from "./fixtures/spatial-voxel-scene";

describe("voxel-scene-adapter-v1", () => {
  it("builds a deterministic P2 scene with exact layer and projection analysis", async () => {
    const left = await buildVoxelCountingScene(voxelCountingAdapterInput());
    const right = await buildVoxelCountingScene(voxelCountingAdapterInput());

    expect(left.adapterVersion).toBe("voxel-scene-adapter-v1");
    expect(left.totalCount).toBe(10);
    expect(left.layerCounts).toEqual([
      { coordinate: 0, count: 6 },
      { coordinate: 1, count: 3 },
      { coordinate: 2, count: 1 },
    ]);
    expect(left.projections.map((projection) => projection.view)).toEqual(["front", "right", "top"]);
    expect(left.sceneHash).toBe(await canonicalSha256(left.scene));
    expect(right.sceneHash).toBe(left.sceneHash);
    expect(right.scene).toEqual(left.scene);
  });

  it("authors prediction, three views, one step per layer and a final count checkpoint", async () => {
    const built = await buildVoxelCountingScene(voxelCountingAdapterInput());
    expect(built.scene.presentation.cameraBookmarks.map((camera) => camera.id)).toEqual([
      "camera.front",
      "camera.perspective",
      "camera.right",
      "camera.top",
    ]);
    expect(built.scene.presentation.layers.map((layer) => layer.id)).toEqual([
      "layer.y.c1024",
      "layer.y.c1025",
      "layer.y.c1026",
    ]);
    expect(built.scene.sequence.steps.map((step) => step.id)).toEqual([
      "step.predict",
      "step.front",
      "step.right",
      "step.top",
      "step.layer.001",
      "step.layer.002",
      "step.layer.003",
      "step.verify",
    ]);
    expect(built.scene.checkpoints[0]).toMatchObject({
      id: "checkpoint.total-count",
      type: "numeric",
      evaluator: { kind: "derived", query: { kind: "voxel.total", entityId: "voxel.main" } },
    });
    expect(built.scene.accessibility.summary.zh).not.toContain("10");
    expect(built.scene.accessibility.orthographicViews.map((view) => view.view)).toEqual(["front", "right", "top"]);
  });

  it("materializes only the native 1200x900 standard-4x3 page", async () => {
    const page = await voxelCountingSpatialPage();
    expect(page.layout).toEqual({ profile: "standard-4x3" });
    expect(page.presentation.viewport).toMatchObject({ width: 1_200, height: 900 });
    expect(page.presentation.camera.defaultCameraId).toBe("camera.perspective");
    expect(page.sceneHash).toBe(await canonicalSha256(page.scene));
  });

  it("rejects unstable coordinates and a model that cannot fit one semantic layer step", () => {
    const unstable = voxelCountingAdapterInput();
    unstable.cells = [...unstable.cells].reverse();
    expect(() => parseVoxelSceneAdapterInput(unstable)).toThrow();

    const tooManyLayers = voxelCountingAdapterInput();
    tooManyLayers.cells = Array.from(
      { length: Math.min(SPATIAL_SCENE_LIMITS.maxLayers, SPATIAL_SCENE_LIMITS.maxActionsPerStep - 1) + 1 },
      (_, y) => ({ x: 0, y, z: 0 }),
    );
    expect(() => parseVoxelSceneAdapterInput(tooManyLayers)).toThrow();
  });
});

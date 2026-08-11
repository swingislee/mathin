import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildPolyhedronFoldScene } from "@/features/spatial-math/domain";
import { PolyhedronNetFallback } from "@/features/spatial-math/renderer-r3f/PolyhedronNetFallback";
import {
  POLYHEDRON_FOLD_RENDERER_MAX_DPR,
  POLYHEDRON_FOLD_RENDERER_PROFILE,
  buildPolyhedronFoldRenderModel,
  buildPolyhedronNetFallbackModel,
  createPolyhedronFoldRenderModelResolver,
  interpolatePolyhedronFoldProgress,
} from "@/features/spatial-math/renderer-r3f/polyhedron-fold-render-model";
import { cubeFoldSceneAdapterInput } from "./fixtures/spatial-polyhedron-scene";

describe("polyhedron fold 4:3 render model", () => {
  it("uses kernel-owned face triangles and deterministic frames without deriving math from a mesh", async () => {
    const built = await buildPolyhedronFoldScene(cubeFoldSceneAdapterInput());
    const first = buildPolyhedronFoldRenderModel(built.scene, "polyhedron.cube", 0.5, "zh", {
      selectedFaceIds: ["face.z.neg"],
    });
    const second = buildPolyhedronFoldRenderModel(built.scene, "polyhedron.cube", 0.5, "zh", {
      selectedFaceIds: ["face.z.neg"],
    });
    const prepared = createPolyhedronFoldRenderModelResolver(built.scene, "polyhedron.cube", "zh");

    expect(first).toEqual(second);
    expect(prepared.resolve(0.5, ["face.z.neg"])).toEqual(first);
    expect(prepared.resolve(1).progressMillionths).toBe(1_000_000);
    expect(first.profile).toBe(POLYHEDRON_FOLD_RENDERER_PROFILE);
    expect(first.profile).toBe("standard-4x3");
    expect(POLYHEDRON_FOLD_RENDERER_MAX_DPR).toBe(1.5);
    expect(first.progressMillionths).toBe(500_000);
    expect(first.camera.id).toBe("camera.front");
    expect(first.faces).toHaveLength(6);
    expect(first.faces.every((face) => face.triangleVertexIndices.length === 2)).toBe(true);
    expect(first.faces.every((face) => face.trianglePositions.length === 18)).toBe(true);
    expect(first.faces.every((face) => face.edgePositions.length === 24)).toBe(true);
    expect(first.faces.find((face) => face.faceId === "face.z.neg")).toMatchObject({
      label: "后面",
      selected: true,
      colliding: false,
    });
    expect(first.bounds.radius).toBeGreaterThan(0);
    expect(interpolatePolyhedronFoldProgress(0, 1, 400, 800, "linear")).toBe(0.5);
    expect(interpolatePolyhedronFoldProgress(0, 1, 200, 800, "ease-in-out")).toBe(0.15625);
    expect(interpolatePolyhedronFoldProgress(0.25, 1, 800, 800, "ease-in-out")).toBe(1);
  });

  it("honors authored camera bookmarks and rejects invalid runtime requests", async () => {
    const built = await buildPolyhedronFoldScene(cubeFoldSceneAdapterInput());
    const perspective = buildPolyhedronFoldRenderModel(built.scene, "polyhedron.cube", 1, "en", {
      cameraId: "camera.perspective",
    });

    expect(perspective.camera).toMatchObject({ id: "camera.perspective", projection: "perspective" });
    expect(perspective.label).toBe("Cube");
    expect(() => buildPolyhedronFoldRenderModel(built.scene, "polyhedron.cube", -0.01, "zh")).toThrow(RangeError);
    expect(() =>
      buildPolyhedronFoldRenderModel(built.scene, "polyhedron.cube", 0, "zh", { cameraId: "camera.missing" }),
    ).toThrow("unknown spatial camera bookmark");
  });
});

describe("polyhedron-net-2d-v1 fallback", () => {
  it("projects every labeled face and validated hinge into a semantic 2D model", async () => {
    const built = await buildPolyhedronFoldScene(cubeFoldSceneAdapterInput());
    const model = buildPolyhedronNetFallbackModel(built.scene, "polyhedron.cube", "en", ["face.x.neg"]);

    expect(model.profile).toBe("standard-4x3");
    expect(model.label).toBe("Cube");
    expect(model.summary).toContain("six squares");
    expect(model.faces).toHaveLength(6);
    expect(model.hinges).toHaveLength(5);
    expect(model.hinges.map((hinge) => hinge.order)).toEqual([1, 2, 3, 4, 5]);
    expect(model.faces.find((face) => face.faceId === "face.x.neg")).toMatchObject({
      label: "Left",
      selected: true,
    });
    expect(model.viewBox.width).toBeGreaterThan(model.viewBox.height);
  });

  it("renders a keyboard-selectable SVG and keeps the same structural fallback in read-only mode", async () => {
    const built = await buildPolyhedronFoldScene(cubeFoldSceneAdapterInput());
    const interactive = renderToStaticMarkup(
      createElement(PolyhedronNetFallback, {
        scene: built.scene,
        entityId: "polyhedron.cube",
        locale: "zh",
        selectedFaceIds: ["face.z.neg"],
        onFaceSelect: () => undefined,
        statusMessage: "二维模式",
      }),
    );
    const readOnly = renderToStaticMarkup(
      createElement(PolyhedronNetFallback, {
        scene: built.scene,
        entityId: "polyhedron.cube",
        locale: "zh",
        readOnly: true,
      }),
    );

    expect(interactive).toContain('data-layout-profile="standard-4x3"');
    expect(interactive).toContain('data-spatial-fallback="polyhedron-net-2d-v1"');
    expect(interactive.match(/data-face-id=/g)).toHaveLength(6);
    expect(interactive.match(/data-hinge-edge-id=/g)).toHaveLength(5);
    expect(interactive).toContain('role="button"');
    expect(interactive).toContain('aria-pressed="true"');
    expect(interactive).toContain("二维模式");
    expect(readOnly).not.toContain('role="button"');
  });
});

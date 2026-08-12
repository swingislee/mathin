import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  isPolyhedronFoldFaceSelectable,
  matchPolyhedronFoldProjectionValue,
  polyhedronFoldProjectionVisibleHalfHeight,
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
    expect(first.camera.projection).toBe("orthographic");
    expect(first.displayTarget).toEqual(first.camera.target);
    expect(first.faces).toHaveLength(6);
    expect(first.faces.every((face) => face.triangleVertexIndices.length === 2)).toBe(true);
    expect(first.faces.every((face) => face.trianglePositions.length === 18)).toBe(true);
    expect(first.faces.every((face) => face.edgePositions.length === 24)).toBe(true);
    expect(first.faces.reduce((total, face) => total + face.edgePositions.length / 6, 0)).toBe(24);
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

  it("preserves vertical framing when camera bookmarks cross projection types", () => {
    const halfHeight = 3;
    const distance = 8;
    const perspectiveFov = 50;
    const visibleBefore = polyhedronFoldProjectionVisibleHalfHeight(
      "perspective",
      perspectiveFov,
      halfHeight,
      distance,
    );
    const matchedZoom = matchPolyhedronFoldProjectionValue(
      "perspective",
      "orthographic",
      perspectiveFov,
      halfHeight,
      distance,
    );
    const visibleAfter = polyhedronFoldProjectionVisibleHalfHeight(
      "orthographic",
      matchedZoom,
      halfHeight,
      distance,
    );

    expect(visibleAfter).toBeCloseTo(visibleBefore, 10);
    expect(
      matchPolyhedronFoldProjectionValue(
        "orthographic",
        "perspective",
        matchedZoom,
        halfHeight,
        distance,
      ),
    ).toBeCloseTo(perspectiveFov, 10);
    expect(() => polyhedronFoldProjectionVisibleHalfHeight("perspective", 180, halfHeight, distance)).toThrow(
      RangeError,
    );
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

  it("exposes only an explicit checkpoint option set as interactive faces", async () => {
    const built = await buildPolyhedronFoldScene(cubeFoldSceneAdapterInput());
    const markup = renderToStaticMarkup(
      createElement(PolyhedronNetFallback, {
        scene: built.scene,
        entityId: "polyhedron.cube",
        locale: "en",
        selectableFaceIds: ["face.x.neg", "face.x.pos", "face.z.neg"],
        onFaceSelect: () => undefined,
      }),
    );

    expect(markup.match(/data-face-selectable="true"/g)).toHaveLength(3);
    expect(markup.match(/data-face-selectable="false"/g)).toHaveLength(3);
    expect(markup.match(/role="button"/g)).toHaveLength(3);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(3);
    expect(isPolyhedronFoldFaceSelectable("face.x.neg", ["face.x.neg"])).toBe(true);
    expect(isPolyhedronFoldFaceSelectable("face.x.pos", ["face.x.neg"])).toBe(false);
    expect(isPolyhedronFoldFaceSelectable("face.x.pos", [])).toBe(false);
    expect(isPolyhedronFoldFaceSelectable("face.x.pos")).toBe(true);
  });

  it("reuses the accepted orbit transition for authored camera bookmarks", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/features/spatial-math/renderer-r3f/PolyhedronFoldCanvas.tsx"),
      "utf8",
    );

    expect(source).toContain("VOXEL_CAMERA_TRANSITION_MS");
    expect(source).toContain("interpolateVoxelCameraPose");
    expect(source).toContain("voxelCameraTransitionProgress");
    expect(source).toContain("matchPolyhedronFoldProjectionValue");
    expect(source).toContain('data-camera-transition="orbit-ease-in-out"');
    expect(source).toContain('data-camera-transition-state="idle"');
    expect(source).toContain("if (reducedMotion)");
  });

  it("uses opaque solid faces and one instanced ink-edge draw instead of WebGL line widths", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/features/spatial-math/renderer-r3f/PolyhedronFoldCanvas.tsx"),
      "utf8",
    );

    expect(source).toContain("<meshBasicMaterial");
    expect(source).toContain("toneMapped={false}");
    expect(source).toContain("<FoldEdges faces={model.faces}");
    expect(source.match(/<instancedMesh/g)).toHaveLength(1);
    expect(source).toContain("<boxGeometry");
    expect(source).toContain("computeBoundingSphere()");
    expect(source).toContain("raycast={() => null}");
    expect(source).toContain("event.stopPropagation()");
    expect(source).toContain("if (selectable) onFaceSelect(face.faceId)");
    expect(source).toContain("model.displayTarget.x - model.bounds.center.x");
    expect(source).not.toContain("distanceFactor={6}");
    expect(source).toContain("min-w-7");
    expect(source).not.toContain("<meshStandardMaterial");
    expect(source).not.toContain("!selectable || !onFaceSelect");
    expect(source).not.toContain("<lineBasicMaterial");
    expect(source).not.toContain("transparent={true}");
    expect(source).not.toContain("opacity={");
  });
});

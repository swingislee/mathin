import { beforeAll, describe, expect, it } from "vitest";
import { Matrix4, Vector3 } from "three";
import { buildCubeNetGalleryFolding, createCubeNetGalleryCatalog, createCubeNetGalleryFoldingRequest, type CubeNetGalleryFoldingBuild } from "@/features/spatial-math/domain";
import { createCubeNetWorkbenchResolver, transformCubeNetWorkbenchModel } from "@/features/tools/spatial-lab/cube-net-workbench-model";
import { createCubeNetTableAlignment } from "@/features/tools/spatial-lab/cube-net-table-alignment";

describe("default X–Z paper placement", () => {
  let build: CubeNetGalleryFoldingBuild;
  beforeAll(async () => { build = await buildCubeNetGalleryFolding(createCubeNetGalleryFoldingRequest(createCubeNetGalleryCatalog().entries.find((entry) => entry.classification === "legal")!.id)); });
  it("levels a tilted sheet without losing its world position or jumping when manual folding resumes", () => {
    const resolver = createCubeNetWorkbenchResolver(build, "zh"), flat = resolver.resolve({}).model;
    for (const angle of [0.7, 2.3, -1.2]) {
      const transform = new Matrix4().makeRotationAxis(new Vector3(1, 2, 3).normalize(), angle).setPosition(2, 3, -1);
      const tilted = transformCubeNetWorkbenchModel(flat, (point) => {
        const position = new Vector3(point.x, point.y, point.z).applyMatrix4(transform);
        return { x: position.x, y: position.y, z: position.z };
      });
      const alignment = createCubeNetTableAlignment(tilted, flat, build.sceneInput.layout.rootFaceId);
      expect(alignment.durationMs).toBeGreaterThan(0);
      expect(alignment.sample(0).faces).toEqual(tilted.faces);
      const final = alignment.sample(alignment.durationMs), handedOff = resolver.resolve({}, null, alignment.anchor).model;
      const oldRoot = tilted.faces.find((face) => face.faceId === build.sceneInput.layout.rootFaceId)!;
      const newRoot = final.faces.find((face) => face.faceId === oldRoot.faceId)!;
      expect(newRoot.centroid.x).toBeCloseTo(oldRoot.centroid.x); expect(newRoot.centroid.z).toBeCloseTo(oldRoot.centroid.z);
      for (const face of final.faces) for (const vertex of face.vertices) {
        const next = handedOff.faces.find((item) => item.faceId === face.faceId)!.vertices.find((item) => item.vertexId === vertex.vertexId)!.position;
        expect(vertex.position.y).toBeCloseTo(0); expect(vertex.position.x).toBeCloseTo(next.x); expect(vertex.position.z).toBeCloseTo(next.z);
      }
      expect(createCubeNetTableAlignment(final, flat, oldRoot.faceId).durationMs).toBe(0);
    }
  });
  it("preserves already-flat squares exactly and can align the closed cube before entering the cut path", () => {
    const resolver = createCubeNetWorkbenchResolver(build, "zh"), flat = resolver.resolve({}).model;
    const alignment = createCubeNetTableAlignment(flat, flat, build.sceneInput.layout.rootFaceId);
    expect(alignment.durationMs).toBe(0); expect(alignment.sample(0).faces).toEqual(flat.faces);
    const closed = resolver.resolve(Object.fromEntries(build.sceneInput.hingeGraph.hinges.map((hinge) => [hinge.edgeId, 90]))).model;
    const transform = new Matrix4().makeRotationY(0.8).setPosition(2, 3, -1);
    const moved = transformCubeNetWorkbenchModel(closed, (point) => {
      const position = new Vector3(point.x, point.y, point.z).applyMatrix4(transform);
      return { x: position.x, y: position.y, z: position.z };
    });
    const placement = createCubeNetTableAlignment(moved, closed, build.sceneInput.layout.rootFaceId, false);
    for (const face of placement.sample(placement.durationMs).faces) for (const vertex of face.vertices) {
      const expected = closed.faces.find((item) => item.faceId === face.faceId)!.vertices.find((item) => item.vertexId === vertex.vertexId)!.position;
      expect(vertex.position.x).toBeCloseTo(expected.x); expect(vertex.position.y).toBeCloseTo(expected.y); expect(vertex.position.z).toBeCloseTo(expected.z);
    }
  });
});

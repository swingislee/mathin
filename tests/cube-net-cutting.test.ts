import { beforeAll, describe, expect, it } from "vitest";
import {
  buildCubeNetGalleryFolding, createCubeNetGalleryCatalog, createCubeNetGalleryFoldingRequest,
  createPolyhedronFoldFrameResolver, type CubeNetGalleryFoldingBuild,
} from "@/features/spatial-math/domain";
import { analyzeCubeNetCuts, buildCubeNetFromCuts, createCubeNetCutSceneInput, createCubeNetCutSession, reduceCubeNetCutSession } from "@/features/tools/spatial-lab/cube-net-cutting";
import { createCubeNetWorkbenchResolver } from "@/features/tools/spatial-lab/cube-net-workbench-model";
import { cubeNetHingeProgress, judgeCubeNetFold } from "@/features/tools/spatial-lab/cube-net-teaching-session";
import { createCubeNetUnfoldMotion } from "@/features/tools/spatial-lab/cube-net-unfold-motion";

describe("cube surfaces cut into teacher-chosen nets", () => {
  let base: CubeNetGalleryFoldingBuild;
  beforeAll(async () => {
    base = await buildCubeNetGalleryFolding(createCubeNetGalleryFoldingRequest(createCubeNetGalleryCatalog().entries.find((entry) => entry.classification === "legal")!.id));
  });
  it("distinguishes loops and separated pieces, and reverses cuts one at a time", () => {
    const input = base.sceneInput;
    expect(analyzeCubeNetCuts(input, []).status).toBe("more-cuts");
    expect(analyzeCubeNetCuts(input, []).remainingCuts).toBe(7);
    const isolated = input.topology.edges.filter((edge) => edge.vertexIds.every((id) => input.topology.faces[0].vertexIds.includes(id))).map((edge) => edge.id);
    expect(analyzeCubeNetCuts(input, isolated).status).toBe("disconnected");
    expect(() => createCubeNetCutSceneInput(input, isolated)).toThrow("DISCONNECTED");
    expect(() => analyzeCubeNetCuts(input, ["unknown"])).toThrow("UNKNOWN_CUT_EDGE");
    let state = createCubeNetCutSession();
    for (const edgeId of isolated) state = reduceCubeNetCutSession(state, { kind: "toggle", edgeId });
    const undo = reduceCubeNetCutSession(state, { kind: "undo" });
    expect(undo.cuts).toHaveLength(3);
    expect(reduceCubeNetCutSession(undo, { kind: "redo" }).cuts).toEqual(state.cuts);
    expect(reduceCubeNetCutSession(state, { kind: "toggle", edgeId: isolated[0] }).cuts).toHaveLength(3);
  });
  it("enumerates actual cut trees into all 11 shapes and retains exactly the uncut edges", async () => {
    const edges = base.sceneInput.topology.edges;
    const representatives = new Map<string, readonly string[]>();
    let validCount = 0;
    for (let mask = 0; mask < 2 ** edges.length; mask++) {
      const cuts = edges.filter((_, index) => mask & (1 << index)).map((edge) => edge.id);
      if (analyzeCubeNetCuts(base.sceneInput, cuts).status !== "ready") continue;
      const result = createCubeNetCutSceneInput(base.sceneInput, cuts);
      validCount++;
      expect(result.analysis.isCubeNet).toBe(true);
      expect(result.sceneInput.hingeGraph.hinges.map((hinge) => hinge.edgeId).sort()).toEqual(edges.filter((edge) => !cuts.includes(edge.id)).map((edge) => edge.id).sort());
      const frame = createPolyhedronFoldFrameResolver(result.sceneInput.topology, result.sceneInput.geometry, result.sceneInput.hingeGraph, result.sceneInput.layout);
      const closed = Object.fromEntries(result.sceneInput.hingeGraph.hinges.map((hinge) => [hinge.edgeId, 90]));
      expect(judgeCubeNetFold(frame.resolveHinges(cubeNetHingeProgress(closed)))).toBe("closed");
      representatives.set(result.entry.id, cuts);
    }
    expect(validCount).toBe(384); expect(representatives.size).toBe(11);
    const oldResolver = createCubeNetWorkbenchResolver(base, "zh");
    const closedAngles = Object.fromEntries(base.sceneInput.hingeGraph.hinges.map((hinge) => [hinge.edgeId, 90]));
    const oldCube = oldResolver.resolve(closedAngles).model;
    for (const cuts of representatives.values()) {
      const build = await buildCubeNetFromCuts(base, cuts);
      const support = oldCube.faces[2];
      const vertices = support.vertices.slice(0, 3).map((vertex) => vertex.position);
      const anchor = { faceId: support.faceId, vertices: [vertices[0], vertices[1], vertices[2]] as const };
      const angles = Object.fromEntries(build.sceneInput.hingeGraph.hinges.map((hinge) => [hinge.edgeId, 90]));
      const resolver = createCubeNetWorkbenchResolver(build, "zh");
      const current = resolver.resolve(angles, null, anchor);
      for (const face of current.model.faces) for (const vertex of face.vertices) {
        const before = oldCube.faces.find((item) => item.faceId === face.faceId)!.vertices.find((item) => item.vertexId === vertex.vertexId)!.position;
        expect(vertex.position.x).toBeCloseTo(before.x); expect(vertex.position.y).toBeCloseTo(before.y); expect(vertex.position.z).toBeCloseTo(before.z);
      }
      const motion = createCubeNetUnfoldMotion({ angles, anchor }, current.hinges, build.sceneInput.layout.rootFaceId);
      expect(motion.steps).toHaveLength(5);
      expect(Object.values(motion.sample(motion.durationMs).angles)).toEqual([0, 0, 0, 0, 0]);
    }
  }, 20_000);
});

import { beforeAll, describe, expect, it } from "vitest";
import { analyzePolyhedronTopology, buildCubeNetGalleryFolding, createCubeNetGalleryCatalog, createCubeNetGalleryFoldingRequest, type CubeNetGalleryFoldingBuild } from "@/features/spatial-math/domain";
import { createCubeNetWorkbenchResolver } from "@/features/tools/spatial-lab/cube-net-workbench-model";
import { analyzeCubeNetCuts, createCubeNetCutSession, reduceCubeNetCutSession, cubeNetCutEdges, buildCubeNetFromCuts } from "@/features/tools/spatial-lab/cube-net-cutting";
import { createCubeNetCutUnfoldMotion, cubeNetAvailableCutMoves, cubeNetCutPoseModel } from "@/features/tools/spatial-lab/cube-net-cut-unfold";
import { createCubeNetTableAlignment } from "@/features/tools/spatial-lab/cube-net-table-alignment";

describe("cut, unfold an available face, then continue cutting", () => {
  let build: CubeNetGalleryFoldingBuild;
  beforeAll(async () => { build = await buildCubeNetGalleryFolding(createCubeNetGalleryFoldingRequest(createCubeNetGalleryCatalog().entries.find((entry) => entry.classification === "legal")!.id)); });
  const closedModel = () => createCubeNetWorkbenchResolver(build, "zh").resolve(Object.fromEntries(build.sceneInput.hingeGraph.hinges.map((hinge) => [hinge.edgeId, 90]))).model;

  it("allows each of the six faces after only three cuts, including the mathematical reference face", () => {
    const closed = closedModel(), edges = analyzePolyhedronTopology(build.sceneInput.topology).edges;
    for (const face of closed.faces) for (const kept of edges.filter((edge) => edge.faceIds.includes(face.faceId))) {
      let session = createCubeNetCutSession();
      const cuts = edges.filter((edge) => edge.faceIds.includes(face.faceId) && edge.edgeId !== kept.edgeId).map((edge) => edge.edgeId);
      for (const edgeId of cuts) session = reduceCubeNetCutSession(session, { kind: "toggle", edgeId });
      const choices = cubeNetAvailableCutMoves(build.sceneInput, cuts, closed, true);
      const selected = choices.find((move) => move.movingFaceIds.length === 1 && move.faceId === face.faceId)!;
      expect(selected).toBeTruthy();
      const motion = createCubeNetCutUnfoldMotion(build.sceneInput, closed, session, selected);
      expect(motion.steps).toHaveLength(1);
      const halfway = motion.sample(motion.durationMs / 2).model, final = motion.sample(motion.durationMs).model;
      expect(halfway.faces.find((item) => item.faceId === face.faceId)!.centroid).not.toEqual(face.centroid);
      for (const fixed of final.faces.filter((item) => item.faceId !== face.faceId)) expect(fixed.vertices).toEqual(closed.faces.find((item) => item.faceId === fixed.faceId)!.vertices);
      expect(cubeNetCutEdges(build.sceneInput, final, cuts).length).toBeGreaterThan(12);
      const next = reduceCubeNetCutSession(session, { kind: "unfold", poses: motion.target });
      expect(reduceCubeNetCutSession(next, { kind: "undo" }).poses).toEqual({});
      expect(next.cuts).toEqual(cuts.slice().sort());
      expect(cubeNetAvailableCutMoves(build.sceneInput, cuts, final, true)).toHaveLength(0);
    }
  });

  it("continues after a partial unfold and finishes the actual cut net on X–Z", async () => {
    const closed = closedModel(), edges = analyzePolyhedronTopology(build.sceneInput.topology).edges;
    const target = build.sceneInput.hingeGraph.hinges.map((hinge) => hinge.edgeId);
    const leaf = closed.faces.find((face) => edges.filter((edge) => edge.faceIds.includes(face.faceId) && target.includes(edge.edgeId)).length === 1)!;
    let session = createCubeNetCutSession();
    for (const edge of edges.filter((edge) => edge.faceIds.includes(leaf.faceId) && !target.includes(edge.edgeId))) session = reduceCubeNetCutSession(session, { kind: "toggle", edgeId: edge.edgeId });
    const selected = cubeNetAvailableCutMoves(build.sceneInput, session.cuts, closed, true).find((move) => move.faceId === leaf.faceId && move.movingFaceIds.length === 1)!;
    const partial = createCubeNetCutUnfoldMotion(build.sceneInput, closed, session, selected);
    session = reduceCubeNetCutSession(session, { kind: "unfold", poses: partial.target });
    const partialModel = cubeNetCutPoseModel(closed, session.poses);
    for (const edge of edges.filter((edge) => !target.includes(edge.edgeId) && !session.cuts.includes(edge.edgeId))) session = reduceCubeNetCutSession(session, { kind: "toggle", edgeId: edge.edgeId });
    expect(cubeNetCutPoseModel(closed, session.poses)).toEqual(partialModel);
    const motion = createCubeNetCutUnfoldMotion(build.sceneInput, closed, session);
    expect(motion.steps.length).toBeLessThan(5);
    const final = motion.sample(motion.durationMs).model;
    const compiled = await buildCubeNetFromCuts(build, session.cuts);
    const targetFlat = createCubeNetWorkbenchResolver(compiled, "zh").resolve({}).model;
    const placement = createCubeNetTableAlignment(final, targetFlat, compiled.sceneInput.layout.rootFaceId);
    const onTable = placement.sample(placement.durationMs);
    const handedOff = createCubeNetWorkbenchResolver(compiled, "zh").resolve({}, null, placement.anchor).model;
    for (const face of onTable.faces) for (const vertex of face.vertices) {
      const point = handedOff.faces.find((item) => item.faceId === face.faceId)!.vertices.find((item) => item.vertexId === vertex.vertexId)!.position;
      expect(vertex.position.y).toBeCloseTo(0); expect(vertex.position.x).toBeCloseTo(point.x); expect(vertex.position.z).toBeCloseTo(point.z);
    }
  });
  it("can unfold after every available cut on all 384 spanning trees and hands over the actual paper geometry", async () => {
    const closed = closedModel(), edges = build.sceneInput.topology.edges;
    let checked = 0;
    for (let mask = 0; mask < 2 ** edges.length; mask++) {
      const cuts = edges.filter((_, index) => mask & (1 << index)).map((edge) => edge.id);
      if (analyzeCubeNetCuts(build.sceneInput, cuts).status !== "ready") continue;
      let session = createCubeNetCutSession();
      for (const edgeId of cuts) {
        session = reduceCubeNetCutSession(session, { kind: "toggle", edgeId });
        const motion = createCubeNetCutUnfoldMotion(build.sceneInput, closed, session);
        if (motion.steps.length) session = reduceCubeNetCutSession(session, { kind: "unfold", poses: motion.target });
      }
      const final = cubeNetCutPoseModel(closed, session.poses);
      expect(cubeNetAvailableCutMoves(build.sceneInput, cuts, final, true)).toHaveLength(0);
      const compiled = await buildCubeNetFromCuts(build, cuts), resolver = createCubeNetWorkbenchResolver(compiled, "zh");
      const placement = createCubeNetTableAlignment(final, resolver.resolve({}).model, compiled.sceneInput.layout.rootFaceId);
      const handedOff = resolver.resolve({}, null, placement.anchor).model;
      for (const face of placement.sample(placement.durationMs).faces) for (const vertex of face.vertices) {
        const point = handedOff.faces.find((item) => item.faceId === face.faceId)!.vertices.find((item) => item.vertexId === vertex.vertexId)!.position;
        expect(vertex.position.y).toBeCloseTo(0); expect(vertex.position.x).toBeCloseTo(point.x); expect(vertex.position.z).toBeCloseTo(point.z);
      }
      checked++;
    }
    expect(checked).toBe(384);
  }, 20_000);
});

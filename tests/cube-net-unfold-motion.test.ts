import { beforeAll, describe, expect, it } from "vitest";
import { buildCubeNetGalleryFolding, createCubeNetGalleryCatalog, createCubeNetGalleryFoldingRequest, type CubeNetGalleryFoldingBuild } from "@/features/spatial-math/domain";
import { createCubeNetWorkbenchResolver } from "@/features/tools/spatial-lab/cube-net-workbench-model";
import { createCubeNetTeachingSession, reduceCubeNetTeachingSession } from "@/features/tools/spatial-lab/cube-net-teaching-session";
import { createCubeNetUnfoldMotion, CUBE_NET_UNFOLD_STEP_MS } from "@/features/tools/spatial-lab/cube-net-unfold-motion";
import { cubeNetPaperSelection } from "@/features/tools/spatial-lab/cube-net-fold-drag";
import { createCubeNetPlanarPresentation, cubeNetPlanarTiles } from "@/features/tools/spatial-lab/cube-net-planar-presentation";
import { planCubeNetPlanarChange } from "@/features/tools/spatial-lab/cube-net-planar-motion";
import { Matrix4, Vector3 } from "three";

describe("sequential net unfolding and continuous planar handover", () => {
  let builds: CubeNetGalleryFoldingBuild[];
  beforeAll(async () => {
    builds = await Promise.all(createCubeNetGalleryCatalog().entries.filter((entry) => entry.classification === "legal")
      .map((entry) => buildCubeNetGalleryFolding(createCubeNetGalleryFoldingRequest(entry.id))));
  });

  it("unfolds one hinge at a time, skips flat hinges and commits one undoable operation without moving the support", () => {
    for (const build of builds) {
      const resolver = createCubeNetWorkbenchResolver(build, "zh");
      const initial = resolver.resolve({});
      let session = createCubeNetTeachingSession(initial.hinges.map((hinge) => hinge.edgeId));
      const face = initial.model.faces[0];
      const selected = cubeNetPaperSelection(face, initial.model.faces, initial.hinges, face.centroid)!.selection;
      for (const [index, hinge] of initial.hinges.entries()) session = reduceCubeNetTeachingSession(session, {
        kind: "fold", edgeId: hinge.edgeId, degrees: [90, -45, 0, 60, 30][index], anchor: selected.anchor,
      });
      const motion = createCubeNetUnfoldMotion(session, resolver.resolve(session.angles, null, session.anchor).hinges, build.sceneInput.layout.rootFaceId);
      expect(motion.steps).toHaveLength(4);
      expect(motion.sample(0).angles).toEqual(session.angles);
      for (let step = 0; step < motion.steps.length; step++) {
        const before = motion.sample(step * CUBE_NET_UNFOLD_STEP_MS);
        const halfway = motion.sample((step + 0.5) * CUBE_NET_UNFOLD_STEP_MS);
        expect(Object.keys(before.angles).filter((id) => before.angles[id] !== halfway.angles[id])).toEqual([motion.steps[step].edgeId]);
        expect(halfway.anchor).toEqual(session.anchor);
      }
      const finished = motion.sample(motion.durationMs);
      expect(Object.values(finished.angles).every((angle) => angle === 0)).toBe(true);
      const committed = reduceCubeNetTeachingSession(session, { kind: "unfold", anchor: session.anchor });
      expect(committed.angles).toEqual(finished.angles);
      expect(committed.anchor).toEqual(finished.anchor);
      expect(committed.past).toHaveLength(session.past.length + 1);
      const undo = reduceCubeNetTeachingSession(committed, { kind: "undo" });
      expect(undo.angles).toEqual(session.angles); expect(undo.anchor).toEqual(session.anchor);
    }
  });

  it("keeps visible geometry and labels continuous when the planar motion hands over to every destination net", () => {
    for (const from of builds) for (const target of builds) {
      const resolver = createCubeNetWorkbenchResolver(from, "zh");
      const flat = resolver.resolve({}).model;
      const plan = planCubeNetPlanarChange(cubeNetPlanarTiles(from), target.entry.net.cells);
      const motion = createCubeNetPlanarPresentation(from, target, flat, plan);
      const start = motion.sample(0).model;
      for (const face of start.faces) {
        const original = flat.faces.find((item) => item.faceId === face.faceId)!;
        face.vertices.forEach((vertex, index) => { expect(vertex.position.x).toBeCloseTo(original.vertices[index].position.x); expect(vertex.position.z).toBeCloseTo(original.vertices[index].position.z); });
      }
      const final = motion.sample(motion.durationMs).model;
      const next = createCubeNetWorkbenchResolver(target, "zh").resolve({}, null, motion.anchor).model;
      for (const face of next.faces) {
        const previous = final.faces.find((item) => item.label === motion.labels[face.faceId])!;
        expect(previous).toBeTruthy();
        expect(face.centroid.x).toBeCloseTo(previous.centroid.x); expect(face.centroid.y).toBeCloseTo(previous.centroid.y); expect(face.centroid.z).toBeCloseTo(previous.centroid.z);
        for (const vertex of face.vertices) expect(previous.vertices.some((item) => Math.hypot(item.position.x - vertex.position.x, item.position.y - vertex.position.y, item.position.z - vertex.position.z) < 1e-7)).toBe(true);
      }
    }
  });

  it("keeps a tilted, translated paper plane in place across a sequence of net changes", () => {
    let from = builds[0];
    const resolver = createCubeNetWorkbenchResolver(from, "zh");
    const support = resolver.resolve({}).model.faces[2];
    const placement = new Matrix4().makeRotationAxis(new Vector3(1, 2, 3).normalize(), 0.7).setPosition(2, 3, -1);
    const vertices = support.vertices.slice(0, 3).map((vertex) => {
      const point = new Vector3(vertex.position.x, vertex.position.y, vertex.position.z).applyMatrix4(placement);
      return { x: point.x, y: point.y, z: point.z };
    });
    let flat = resolver.resolve({}, null, { faceId: support.faceId, vertices: [vertices[0], vertices[1], vertices[2]] }).model;
    for (const target of [builds[5], builds[10], builds[2]]) {
      const motion = createCubeNetPlanarPresentation(from, target, flat, planCubeNetPlanarChange(cubeNetPlanarTiles(from), target.entry.net.cells));
      const final = motion.sample(motion.durationMs).model;
      const resolved = createCubeNetWorkbenchResolver(target, "zh").resolve({}, null, motion.anchor).model;
      const next = { ...resolved, faces: resolved.faces.map((face) => ({ ...face, label: motion.labels[face.faceId] })) };
      for (const face of next.faces) {
        const previous = final.faces.find((item) => item.label === face.label)!;
        for (const vertex of face.vertices) expect(previous.vertices.some((item) => Math.hypot(item.position.x - vertex.position.x, item.position.y - vertex.position.y, item.position.z - vertex.position.z) < 1e-7)).toBe(true);
      }
      from = target; flat = next;
    }
  });
});

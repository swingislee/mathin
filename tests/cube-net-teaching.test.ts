import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildCubeNetGalleryFolding,
  createCubeNetGalleryCatalog,
  createCubeNetGalleryFoldingRequest,
  createPolyhedronFoldFrameResolver,
  type CubeNetGalleryFoldingBuild,
} from "@/features/spatial-math/domain";
import {
  CUBE_NET_TEACHING_HISTORY_LIMIT,
  createCubeNetTeachingSession,
  cubeNetHingeProgress,
  cubeNetTeachingFaces,
  judgeCubeNetFold,
  reduceCubeNetTeachingSession,
} from "@/features/tools/spatial-lab/cube-net-teaching-session";
import { cubeGeometry, cubeHingeGraph, cubeTopology, cubeUnitNetLayout } from "./fixtures/spatial-polyhedron-cube";

describe("teacher-controlled cube-net folding", () => {
  let builds: CubeNetGalleryFoldingBuild[];
  beforeAll(async () => {
    builds = await Promise.all(createCubeNetGalleryCatalog().entries
      .filter((entry) => entry.classification === "legal")
      .map((entry) => buildCubeNetGalleryFolding(createCubeNetGalleryFoldingRequest(entry.id))));
  });
  const resolverFor = (build: CubeNetGalleryFoldingBuild) => {
    const { topology, geometry, hingeGraph, layout } = build.sceneInput;
    return createPolyhedronFoldFrameResolver(topology, geometry, hingeGraph, layout);
  };

  it("keeps old global progress identical and recognizes both folding directions for all 11 nets", () => {
    for (const build of builds) {
      const resolver = resolverFor(build);
      const edges = build.sceneInput.hingeGraph.hinges.map((hinge) => hinge.edgeId);
      expect(resolver.resolveHinges({}).faces).toEqual(resolver.resolve(0).faces);
      expect(judgeCubeNetFold(resolver.resolveHinges({}))).toBe("open");
      for (const degrees of [45, 90, -90]) {
        const frame = resolver.resolveHinges(cubeNetHingeProgress(
          Object.fromEntries(edges.map((id) => [id, degrees])),
        ));
        expect(frame.collisionPairs, `${build.entry.id}: ${degrees}`).toEqual([]);
        expect(judgeCubeNetFold(frame)).toBe(Math.abs(degrees) === 90 ? "closed" : "open");
        if (degrees > 0) expect(frame.faces).toEqual(resolver.resolve(Math.round(degrees / 90 * 1_000_000)).faces);
      }
    }
  });

  it("folds only the selected hinge subtree, keeps the root still, and can stop and reverse", () => {
    for (const build of builds) {
      const resolver = resolverFor(build);
      const flat = resolver.resolveHinges({});
      const original = JSON.stringify(build);
      for (const face of cubeNetTeachingFaces(build, "zh")) {
        if (!face.edgeId) continue;
        const moved = resolver.resolveHinges(cubeNetHingeProgress({ [face.edgeId]: 37 }));
        const reversed = resolver.resolveHinges(cubeNetHingeProgress({ [face.edgeId]: -37 }));
        for (const current of moved.faces) {
          const previous = flat.faces.find((item) => item.faceId === current.faceId)!;
          if (face.movingFaceIds.includes(current.faceId)) {
            expect(current.vertices).not.toEqual(previous.vertices);
          } else {
            expect(current).toEqual(previous);
          }
        }
        expect(moved.faces).not.toEqual(reversed.faces);
        expect(judgeCubeNetFold(moved)).toBe("open");
      }
      expect(JSON.stringify(build)).toBe(original);
    }
  });

  it("reports an unfinished or intersecting arrangement without declaring the template impossible", () => {
    const build = builds[0];
    const resolver = resolverFor(build);
    const edges = build.sceneInput.hingeGraph.hinges.map((hinge) => hinge.edgeId);
    const angles = Object.fromEntries(edges.map((id, index) => [id, index === 0 ? -90 : 90]));
    expect(judgeCubeNetFold(resolver.resolveHinges(cubeNetHingeProgress(angles)))).not.toBe("closed");
    // 用既有过折金标覆盖相交分支；教学角度控件的 ±90° 边界单独验证。
    const hinges = cubeHingeGraph({ allMountain: true });
    const collisionResolver = createPolyhedronFoldFrameResolver(
      cubeTopology(), cubeGeometry(), hinges, cubeUnitNetLayout(150_000_000),
    );
    const intersecting = collisionResolver.resolveHinges(Object.fromEntries(
      hinges.hinges.map((hinge) => [hinge.edgeId, 850_000]),
    ));
    expect(intersecting.collisionPairs.length).toBeGreaterThan(0);
    expect(judgeCubeNetFold(intersecting)).toBe("intersection");
  });

  it("rejects unknown hinges and nonfinite or out-of-range controls", () => {
    const resolver = resolverFor(builds[0]);
    const edge = builds[0].sceneInput.hingeGraph.hinges[0].edgeId;
    expect(() => resolver.resolveHinges({ unknown: 0 })).toThrow("UNKNOWN_FOLD_HINGE");
    for (const value of [NaN, Infinity, 1.5, 1_000_001, -1_000_001]) {
      expect(() => resolver.resolveHinges({ [edge]: value })).toThrow();
    }
  });

  it("keeps attached hinge vertices joined after several independent operations", () => {
    for (const build of builds) {
      const resolver = resolverFor(build);
      const faces = cubeNetTeachingFaces(build, "zh");
      const edgeIds = build.sceneInput.hingeGraph.hinges.map((hinge) => hinge.edgeId);
      let session = createCubeNetTeachingSession(edgeIds);
      for (const [index, edgeId] of edgeIds.entries()) {
        session = reduceCubeNetTeachingSession(session, { kind: "fold", edgeId, degrees: [30, -70, 90, -45, 60][index] });
      }
      const frame = resolver.resolveHinges(cubeNetHingeProgress(session.angles));
      const byId = new Map(frame.faces.map((face) => [face.faceId, face]));
      for (const face of faces) {
        if (!face.parentFaceId) continue;
        const child = byId.get(face.faceId)!;
        const parent = byId.get(face.parentFaceId)!;
        const common = child.vertices.filter((vertex) => parent.vertices.some((item) => item.vertexId === vertex.vertexId));
        expect(common).toHaveLength(2);
        for (const vertex of common) {
          const other = parent.vertices.find((item) => item.vertexId === vertex.vertexId)!;
          expect(vertex.position).toEqual(other.position);
        }
      }
    }
  });

  it("builds and controls the local tool without secure-context UUID APIs", async () => {
    vi.stubGlobal("crypto", undefined);
    try {
      const build = await buildCubeNetGalleryFolding(builds[0].request);
      const edgeIds = build.sceneInput.hingeGraph.hinges.map((hinge) => hinge.edgeId);
      const session = reduceCubeNetTeachingSession(createCubeNetTeachingSession(edgeIds), {
        kind: "fold", edgeId: edgeIds[0], degrees: 45,
      });
      expect(resolverFor(build).resolveHinges(cubeNetHingeProgress(session.angles)).faces).toHaveLength(6);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("commits one operation per angle choice and supports bounded undo/redo and undoing unfold", () => {
    const initial = createCubeNetTeachingSession(["hinge.a", "hinge.b"]);
    const first = reduceCubeNetTeachingSession(initial, { kind: "fold", edgeId: "hinge.a", degrees: 37 });
    const second = reduceCubeNetTeachingSession(first, { kind: "fold", edgeId: "hinge.b", degrees: -90 });
    expect(initial.angles).toEqual({ "hinge.a": 0, "hinge.b": 0 });
    expect(second.angles).toEqual({ "hinge.a": 37, "hinge.b": -90 });
    const undo = reduceCubeNetTeachingSession(second, { kind: "undo" });
    expect(undo.angles).toEqual(first.angles);
    expect(reduceCubeNetTeachingSession(undo, { kind: "redo" })).toEqual(second);
    const branch = reduceCubeNetTeachingSession(undo, { kind: "fold", edgeId: "hinge.a", degrees: -45 });
    expect(branch.future).toEqual([]);
    const unfolded = reduceCubeNetTeachingSession(second, { kind: "unfold" });
    expect(unfolded.angles).toEqual(initial.angles);
    expect(reduceCubeNetTeachingSession(unfolded, { kind: "undo" }).angles).toEqual(second.angles);
    expect(reduceCubeNetTeachingSession(first, { kind: "fold", edgeId: "hinge.a", degrees: 37 })).toBe(first);
    expect(() => reduceCubeNetTeachingSession(first, { kind: "fold", edgeId: "unknown", degrees: 0 })).toThrow();
    for (const degrees of [NaN, Infinity, 1.1, 91, -91]) {
      expect(() => reduceCubeNetTeachingSession(first, { kind: "fold", edgeId: "hinge.a", degrees })).toThrow();
    }
    let current = initial;
    for (let index = 0; index < 150; index += 1) {
      current = reduceCubeNetTeachingSession(current, { kind: "fold", edgeId: "hinge.a", degrees: index % 2 ? 45 : 90 });
    }
    expect(current.past).toHaveLength(CUBE_NET_TEACHING_HISTORY_LIMIT);
  });
});

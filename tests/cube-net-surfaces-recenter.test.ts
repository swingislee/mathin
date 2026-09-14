import { beforeAll, describe, expect, it } from "vitest";
import { Matrix4, Vector3 } from "three";
import { buildCubeNetGalleryFolding, createCubeNetGalleryCatalog, createCubeNetGalleryFoldingRequest, type CubeNetGalleryFoldingBuild } from "@/features/spatial-math/domain";
import { CUBE_COLORS } from "@/features/tools/spatial-lab/cube-structures-contract";
import { cubeAnnotationSvg } from "@/features/tools/spatial-lab/cube-structures-annotations";
import { createCubeNetSurfaces, cubeNetFaceStyle, reduceCubeNetSurfaces, styleCubeNetModel } from "@/features/tools/spatial-lab/cube-net-surfaces";
import { createCubeNetTeachingSession, reduceCubeNetTeachingSession } from "@/features/tools/spatial-lab/cube-net-teaching-session";
import { createCubeNetCutSession, reduceCubeNetCutSession } from "@/features/tools/spatial-lab/cube-net-cutting";
import { cubeNetCutPoseModel } from "@/features/tools/spatial-lab/cube-net-cut-unfold";
import { createCubeNetRecenter } from "@/features/tools/spatial-lab/cube-net-recenter";
import { createCubeNetWorkbenchResolver, transformCubeNetWorkbenchModel } from "@/features/tools/spatial-lab/cube-net-workbench-model";
import { createCubeNetPlanarPresentation, cubeNetPlanarTiles } from "@/features/tools/spatial-lab/cube-net-planar-presentation";
import { planCubeNetPlanarChange } from "@/features/tools/spatial-lab/cube-net-planar-motion";

let builds: CubeNetGalleryFoldingBuild[];
beforeAll(async () => {
  builds = await Promise.all(createCubeNetGalleryCatalog().entries.filter((entry) => entry.classification === "legal")
    .map((entry) => buildCubeNetGalleryFolding(createCubeNetGalleryFoldingRequest(entry.id))));
});

describe("per-paper teaching styles", () => {
  it("paints/transparently fills one face, supports optional letters/shapes and independently numbers faces", () => {
    let state = createCubeNetSurfaces();
    expect(cubeNetFaceStyle(state, "A").mark?.kind).toBe("letter");
    state = reduceCubeNetSurfaces(state, { kind: "paint", ids: ["A"], color: CUBE_COLORS[1] });
    state = reduceCubeNetSurfaces(state, { kind: "opacity", ids: ["A"], opacity: 0 });
    state = reduceCubeNetSurfaces(state, { kind: "mark", ids: ["A"], mark: { kind: "star", color: CUBE_COLORS[2] } });
    state = reduceCubeNetSurfaces(state, { kind: "number", id: "A", color: CUBE_COLORS[3] });
    expect(cubeNetFaceStyle(state, "A")).toMatchObject({ color: CUBE_COLORS[1], opacity: 0, mark: { kind: "star" }, number: { value: 1 } });
    expect(cubeNetFaceStyle(state, "B")).toMatchObject({ color: CUBE_COLORS[0], opacity: 1, number: null });
    expect(reduceCubeNetSurfaces(state, { kind: "number", id: "A", color: CUBE_COLORS[1] })).toBe(state);
    state = reduceCubeNetSurfaces(state, { kind: "number", id: "B", color: CUBE_COLORS[3] });
    expect(cubeNetFaceStyle(state, "B").number?.value).toBe(2);
    state = reduceCubeNetSurfaces(state, { kind: "mark", ids: ["A"], mark: null });
    expect(cubeNetFaceStyle(state, "A").mark).toBeNull(); expect(cubeNetFaceStyle(state, "A").number?.value).toBe(1);
    state = reduceCubeNetSurfaces(state, { kind: "restart-numbering" });
    expect(state.nextNumber).toBe(1); expect(Object.values(state.faces).every((face) => !face.number)).toBe(true);
    for (const opacity of [-1, 1.1, NaN]) expect(() => reduceCubeNetSurfaces(state, { kind: "opacity", ids: ["A"], opacity })).toThrow();
    expect(cubeAnnotationSvg({ color: CUBE_COLORS[1], text: "A" })).toContain(">A</text>");
    expect(cubeAnnotationSvg({ color: CUBE_COLORS[1], text: "<>&" })).toContain("&lt;&gt;&amp;");
  });

  it("undoes style and geometry in the same order in folding and cutting sessions", () => {
    const initial = createCubeNetTeachingSession(["hinge"]);
    const painted = reduceCubeNetTeachingSession(initial, { kind: "surface", operation: { kind: "paint", ids: ["A"], color: CUBE_COLORS[1] } });
    const folded = reduceCubeNetTeachingSession(painted, { kind: "fold", edgeId: "hinge", degrees: 50 });
    const undone = reduceCubeNetTeachingSession(folded, { kind: "undo" });
    expect(undone.angles).toEqual(painted.angles); expect(undone.surfaces).toEqual(painted.surfaces);
    expect(reduceCubeNetTeachingSession(undone, { kind: "undo" }).surfaces).toEqual(initial.surfaces);
    const cutInitial = createCubeNetCutSession(painted.surfaces);
    const cut = reduceCubeNetCutSession(cutInitial, { kind: "toggle", edgeId: "edge" });
    const numbered = reduceCubeNetCutSession(cut, { kind: "surface", operation: { kind: "number", id: "A", color: CUBE_COLORS[2] } });
    const cutUndo = reduceCubeNetCutSession(numbered, { kind: "undo" });
    expect(cutUndo.cuts).toEqual(["edge"]); expect(cutUndo.surfaces).toEqual(painted.surfaces);
    expect(reduceCubeNetCutSession(cutUndo, { kind: "redo" })).toEqual(numbered);
  });

  it("keeps all six styles attached to physical paper through net changes and final handoff", () => {
    const source = builds[0], flat = createCubeNetWorkbenchResolver(source, "zh").resolve({}).model;
    let styles = createCubeNetSurfaces();
    for (const [index, face] of flat.faces.entries()) {
      styles = reduceCubeNetSurfaces(styles, { kind: "paint", ids: [face.label], color: CUBE_COLORS[index] });
      styles = reduceCubeNetSurfaces(styles, { kind: "number", id: face.label, color: CUBE_COLORS[index] });
    }
    for (const target of builds.slice(1)) {
      const transition = createCubeNetPlanarPresentation(source, target, flat, planCubeNetPlanarChange(cubeNetPlanarTiles(source), target.entry.net.cells));
      for (const t of [0, transition.durationMs / 2, transition.durationMs]) {
        const model = transition.sample(t).model, rendered = styleCubeNetModel(model, styles);
        expect(new Set(rendered.faces.map((face) => face.materialToken)).size).toBe(6);
        for (const [index, face] of model.faces.entries()) {
          expect(rendered.faces[index].materialToken).toBe(cubeNetFaceStyle(styles, face.label).color);
          expect(rendered.faces[index].label).toBe("");
          expect(face.label).toMatch(/^[A-F]$/);
        }
      }
      const final = createCubeNetWorkbenchResolver(target, "zh").resolve({}, null, transition.anchor).model;
      expect(final.faces.map((face) => cubeNetFaceStyle(styles, transition.labels[face.faceId]).number?.value).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });
});

describe("smooth, non-destructive return to origin", () => {
  it("recenters folded paper with unchanged angles, size, labels and styles, and can undo", () => {
    for (const build of builds) {
      const resolver = createCubeNetWorkbenchResolver(build, "zh");
      let session = createCubeNetTeachingSession(build.sceneInput.hingeGraph.hinges.map((h) => h.edgeId));
      session = { ...session, angles: Object.fromEntries(Object.keys(session.angles).map((id, i) => [id, 20 + i * 10])) };
      const base = resolver.resolve(session.angles).model;
      const shifted = transformCubeNetWorkbenchModel(base, (p) => ({ x: p.x + 17, y: p.y + 3, z: p.z - 21 }));
      const motion = createCubeNetRecenter(shifted, build.sceneInput.layout.rootFaceId);
      expect(motion.durationMs).toBe(650); expect(motion.sample(0).faces).toEqual(shifted.faces);
      expect(motion.sample(325).bounds.center.x).toBeCloseTo(shifted.bounds.center.x / 2);
      expect(motion.target.bounds.center.x).toBeCloseTo(0); expect(motion.target.bounds.center.z).toBeCloseTo(0); expect(motion.target.bounds.min.y).toBeCloseTo(0);
      expect(motion.target.bounds.radius).toBeCloseTo(shifted.bounds.radius);
      const next = reduceCubeNetTeachingSession(session, { kind: "recenter", anchor: motion.anchor });
      expect(next.angles).toEqual(session.angles); expect(next.surfaces).toBe(session.surfaces);
      const resolved = resolver.resolve(next.angles, null, next.anchor).model;
      for (const [i, face] of resolved.faces.entries()) face.vertices.forEach((v, j) => {
        const end = motion.target.faces[i].vertices[j].position;
        expect(new Vector3(v.position.x, v.position.y, v.position.z).distanceTo(new Vector3(end.x, end.y, end.z))).toBeLessThan(1e-7);
      });
      expect(reduceCubeNetTeachingSession(next, { kind: "undo" }).anchor).toBe(session.anchor);
      expect(createCubeNetRecenter(resolved, build.sceneInput.layout.rootFaceId).durationMs).toBe(0);
    }
  });

  it("translates all existing cut poses together, preserving cuts and their undo history", () => {
    const build = builds[0], source = createCubeNetWorkbenchResolver(build, "zh").resolve(Object.fromEntries(build.sceneInput.hingeGraph.hinges.map((h) => [h.edgeId, 90]))).model;
    const poses = Object.fromEntries(source.faces.map((face, i) => [face.faceId, new Matrix4().makeTranslation(8, i === 0 ? 2 : 0, -13).toArray()]));
    const session = { ...createCubeNetCutSession(), cuts: ["edge"], poses };
    const before = cubeNetCutPoseModel(source, poses), motion = createCubeNetRecenter(before, build.sceneInput.layout.rootFaceId, poses);
    const after = cubeNetCutPoseModel(source, motion.poses);
    expect(after.bounds.center.x).toBeCloseTo(0); expect(after.bounds.center.z).toBeCloseTo(0); expect(after.bounds.min.y).toBeCloseTo(0);
    expect(after.bounds.radius).toBeCloseTo(before.bounds.radius);
    const moved = reduceCubeNetCutSession(session, { kind: "recenter", poses: motion.poses });
    expect(moved.cuts).toBe(session.cuts); expect(moved.surfaces).toBe(session.surfaces);
    expect(reduceCubeNetCutSession(moved, { kind: "undo" }).poses).toEqual(session.poses);
  });
});

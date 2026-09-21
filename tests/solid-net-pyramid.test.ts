import { describe, expect, it } from "vitest";
import { createDefaultSolidNetsPolyhedraSnapshot, createDefaultSolidNetsTeachingSnapshot, resizeSolidNet, solidNetsPolyhedraSnapshotSchema,
  solidNetsPolyhedraToolSchema, solidNetsTeachingSnapshotSchema, SOLID_NETS_POLYHEDRA_LESSON_VERSION, SOLID_NETS_LESSON_VERSION } from "@/features/tools/solid-nets/contract";
import { solidNetFaceArea, solidNetGeometry, type SolidNetPoint } from "@/features/tools/solid-nets/geometry";
import { resolveSolidNet, solidNetAllMotion, solidNetSnapshotTransition } from "@/features/tools/solid-nets/model";
import { cubeNetPaperSelection, beginCubeNetFoldDrag, finishCubeNetFoldDrag } from "@/features/tools/spatial-lab/cube-net-fold-drag";
import { freezeToolScene, parseToolScene } from "@/features/tools/scenes/contract";
import { createClassroomToolState, parseClassroomToolState, coursewareToolOriginHash } from "@/features/tools/courseware/tool-classroom";
import { toolSceneRuntime } from "@/features/tools/scenes/runtime";
import { createEmptyCoursewareCompositionPage, coursewareCompositionPageSchema } from "@/features/courseware-doc/composition-page-schema";
import { addCoursewareCompositionTool } from "@/features/courseware-doc/composition-page-layout";

const distance = (a: SolidNetPoint, b: SolidNetPoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const pyramid = (width = 3, height = 2) => createDefaultSolidNetsPolyhedraSnapshot("square-pyramid", { width, height, depth: width });

describe("right square pyramid: rigid triangular paper and exact closure", () => {
  it.each([[3, 2], [2, 1], [0.25, 8], [8, 0.25], [8, 8]])("closes every side at the same apex for base %s and height %s", (width, height) => {
    const initial = pyramid(width, height), original = JSON.stringify(initial), geometry = solidNetGeometry(initial.kind, initial.dimensions);
    expect(geometry.faces.map((face) => face.vertices.length)).toEqual([4, 3, 3, 3, 3]);
    expect(geometry.faces.flatMap((face) => face.vertices).every((p) => p.y === 0)).toBe(true);
    expect(geometry.faces.reduce((sum, face) => sum + solidNetFaceArea(face), 0)).toBeCloseTo(width ** 2 + 2 * width * Math.hypot(width / 2, height), 9);
    const motion = solidNetAllMotion(initial, true), model = resolveSolidNet(motion.target).model;
    expect(model.faces[0].vertices.map((v) => v.position)).toEqual(geometry.faces[0].vertices);
    for (const face of model.faces.slice(1)) expect(distance(face.vertices[1].position, { x: 0, y: height, z: 0 })).toBeLessThan(1e-8);
    const edges = new Map<string, number>();
    for (const face of model.faces) for (let i = 0; i < face.vertices.length; i++) {
      const key = [face.vertices[i], face.vertices[(i + 1) % face.vertices.length]].map(({ position: p }) => [p.x, p.y, p.z].map((v) => Math.round(v * 1e7)).join(",")).sort().join("/");
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    expect(edges.size).toBe(8); expect([...edges.values()].every((n) => n === 2)).toBe(true);
    expect(solidNetsPolyhedraSnapshotSchema.parse(motion.target)).toEqual(motion.target);
    expect(JSON.stringify(initial)).toBe(original);
  });

  it("shows sequential intermediate frames with rigid triangles and connected hinges", () => {
    const initial = pyramid(), geometry = solidNetGeometry(initial.kind, initial.dimensions), motion = solidNetAllMotion(initial, true);
    expect(motion.sample(220).angles["base-left"]).toBeCloseTo(motion.target.angles["base-left"] / 2);
    expect(motion.sample(220).angles["base-right"]).toBe(0);
    for (let time = 0; time <= motion.durationMs; time += 131) {
      const frame = motion.sample(time), resolved = resolveSolidNet(frame);
      expect(solidNetsPolyhedraSnapshotSchema.safeParse(frame).success).toBe(true);
      for (const face of geometry.faces) {
        const drawn = resolved.model.faces.find((entry) => entry.faceId === face.id)!;
        for (let a = 0; a < face.vertices.length; a++) for (let b = a + 1; b < face.vertices.length; b++) {
          expect(distance(drawn.vertices[a].position, drawn.vertices[b].position)).toBeCloseTo(distance(face.vertices[a], face.vertices[b]), 9);
        }
      }
      for (const hinge of resolved.hinges) for (const id of [hinge.parentFaceId, hinge.faceId]) {
        const face = resolved.model.faces.find((entry) => entry.faceId === id)!;
        for (const end of [hinge.start, hinge.end]) expect(face.vertices.some((v) => distance(v.position, end) < 1e-8)).toBe(true);
      }
    }
    const opening = solidNetAllMotion(motion.target, false);
    expect(opening.sample(220).angles["base-left"]).toBeCloseTo(motion.target.angles["base-left"] / 2);
    expect(opening.sample(220).angles["base-right"]).toBe(motion.target.angles["base-right"]);
    expect(opening.sample(opening.durationMs)).toEqual(initial);
  });

  it("allows any paper face to move, preserves the chosen support and returns to XZ smoothly", () => {
    const initial = pyramid(), before = resolveSolidNet(initial);
    for (const face of before.model.faces) {
      const selection = cubeNetPaperSelection(face, before.model.faces, before.hinges, face.centroid)!.selection;
      const changed = solidNetsPolyhedraSnapshotSchema.parse({ ...initial, angles: { ...initial.angles, [selection.edgeId]: 52 }, anchor: selection.anchor });
      const after = resolveSolidNet(changed);
      for (const other of before.model.faces.filter((f) => !selection.movingFaceIds.includes(f.faceId))) {
        const current = after.model.faces.find((f) => f.faceId === other.faceId)!;
        expect(current.vertices.every((v, i) => distance(v.position, other.vertices[i].position) < 1e-8)).toBe(true);
      }
      expect(distance(after.model.faces.find((f) => f.faceId === face.faceId)!.centroid, face.centroid)).toBeGreaterThan(0.1);
      const transition = solidNetSnapshotTransition(initial, changed)!;
      expect(transition.sample(160).angles[selection.edgeId]).toBeCloseTo(26);
      expect(transition.sample(320)).toEqual(changed);
      const reset = solidNetAllMotion(changed, false);
      for (let time = 0; time <= reset.durationMs; time += 97) expect(solidNetsPolyhedraSnapshotSchema.safeParse(reset.sample(time)).success).toBe(true);
      expect(reset.target).toEqual(initial);
    }
    const hinge = before.hinges[0], face = before.model.faces[1], project = (p: SolidNetPoint) => ({ x: p.x * 100, y: p.y * 100 });
    const drag = beginCubeNetFoldDrag(hinge, face.centroid, 0, project(face.centroid), project)!;
    expect(hinge.maxDegrees).toBeCloseTo(126.86989765);
    expect(finishCubeNetFoldDrag(hinge.maxDegrees! - 2, drag)).toBe(hinge.maxDegrees);
    expect(finishCubeNetFoldDrag(-hinge.maxDegrees! + 2, drag)).toBe(-hinge.maxDegrees!);
  });
});

describe("versioned pyramid scene and classroom contract", () => {
  it("rejects non-square bases, foreign faces, incorrect anchors and excessive fold angles", () => {
    const initial = pyramid(), closed = solidNetAllMotion(initial, true).target;
    for (const change of [
      { dimensions: { width: 3, height: 2, depth: 4 } }, { dimensions: { width: 3, height: 0, depth: 3 } },
      { angles: { ...initial.angles, "base-front": closed.angles["base-front"] + 0.001 } }, { angles: { ...initial.angles, "front-top": 0 } },
      { surfaces: { ...initial.surfaces, top: initial.surfaces.base } },
      { anchor: { faceId: "left", vertices: [{ x: -1.5, y: 0, z: -1.5 }, { x: -4, y: 0, z: 0 }, { x: -1.5, y: 0, z: 1.6 }] } },
      { kind: "cone" }, { version: "solid-nets-v2" },
    ]) expect(solidNetsPolyhedraSnapshotSchema.safeParse({ ...initial, ...change }).success).toBe(false);
    expect(solidNetsTeachingSnapshotSchema.safeParse({ ...initial, version: "solid-nets-v2" }).success).toBe(false);
    initial.surfaces.front.label = "侧面"; initial.surfaces.front.opacity = 0.3;
    const resized = resizeSolidNet(initial, { width: 4, height: 3, depth: 4 });
    expect(resized.surfaces).toEqual(initial.surfaces); expect(resized.version).toBe(initial.version);
    expect(solidNetAllMotion(resized, true).target.angles["base-left"]).not.toBe(closed.angles["base-left"]);
  });

  it("freezes, restores and isolates new and old classroom instances using the shared tools transport", () => {
    const scene = solidNetsPolyhedraToolSchema.parse({ toolId: "solid-nets", contentVersion: SOLID_NETS_POLYHEDRA_LESSON_VERSION,
      payload: { title: "Pyramid", initial: pyramid() } });
    const frozen = freezeToolScene(scene), changed = solidNetsPolyhedraSnapshotSchema.parse(solidNetAllMotion(scene.payload.initial, true).target);
    expect(parseToolScene(JSON.parse(JSON.stringify(scene)))).toEqual(scene);
    const page = addCoursewareCompositionTool(createEmptyCoursewareCompositionPage(), frozen);
    expect(coursewareCompositionPageSchema.parse(page)).toEqual(page);
    const update = { toolId: scene.toolId, contentVersion: scene.contentVersion, state: changed };
    const origin = coursewareToolOriginHash(scene.payload), event = createClassroomToolState("page", "doc", "pyramid", update, origin);
    expect(parseClassroomToolState(event)).toEqual(event);
    expect(toolSceneRuntime<typeof SOLID_NETS_POLYHEDRA_LESSON_VERSION>(scene, { state: update })?.state).toEqual(changed);
    expect(toolSceneRuntime<typeof SOLID_NETS_POLYHEDRA_LESSON_VERSION>(scene, { state: update })?.onChange).toBeUndefined();
    const legacy = { toolId: "solid-nets" as const, contentVersion: SOLID_NETS_LESSON_VERSION, state: createDefaultSolidNetsTeachingSnapshot() };
    expect(toolSceneRuntime<typeof SOLID_NETS_POLYHEDRA_LESSON_VERSION>(scene, { state: legacy })?.state).toBeUndefined();
    expect(parseClassroomToolState({ ...event, contentVersion: SOLID_NETS_LESSON_VERSION })).toBeNull();
    const reset = createClassroomToolState("page", "doc", "pyramid", { ...update, state: scene.payload.initial }, origin);
    expect(parseClassroomToolState(reset)?.state).toEqual(scene.payload.initial);
    expect(frozen).toEqual(scene); expect(scene.payload.initial.angles["base-left"]).toBe(0);
  });
});

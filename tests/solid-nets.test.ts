import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { createDefaultSolidNetsSnapshot, resizeSolidNet, solidNetsSnapshotSchema, type SolidNetsSnapshot } from "@/features/tools/solid-nets/contract";
import { solidNetFaceArea, solidNetGeometry, type SolidNetPoint } from "@/features/tools/solid-nets/geometry";
import { resolveSolidNet, solidNetAllMotion, solidNetSnapshotTransition } from "@/features/tools/solid-nets/model";
import { beginCubeNetFoldDrag, cubeNetPaperSelection, finishCubeNetFoldDrag, updateCubeNetFoldDrag } from "@/features/tools/spatial-lab/cube-net-fold-drag";

const distance = (a: SolidNetPoint, b: SolidNetPoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const vector = (p: SolidNetPoint) => new Vector3(p.x, p.y, p.z);
const closed = (value: SolidNetsSnapshot) => solidNetAllMotion(value, true).target;

describe("exact adjustable polyhedral nets", () => {
  for (const kind of ["cuboid", "triangular-prism"] as const) {
    it(`${kind}: lays flat on X–Z and closes with exact face areas, shared vertices and volume`, () => {
      const dimensions = { width: 4, height: 3, depth: 5 }, snapshot = createDefaultSolidNetsSnapshot(kind, dimensions), before = JSON.stringify(snapshot);
      const layout = solidNetGeometry(kind, dimensions), folded = resolveSolidNet(closed(snapshot)).model;
      expect(resolveSolidNet(snapshot).model.faces.flatMap((face) => face.vertices).every((vertex) => vertex.position.y === 0)).toBe(true);
      expect(layout.faces).toHaveLength(kind === "cuboid" ? 6 : 5);
      const expectedArea = kind === "cuboid" ? 2 * (4 * 3 + 4 * 5 + 3 * 5) : 4 * 5 + 2 * Math.hypot(2, 3) * 5 + 4 * 3;
      expect(layout.faces.reduce((sum, face) => sum + solidNetFaceArea(face), 0)).toBeCloseTo(expectedArea, 10);
      const unique: SolidNetPoint[] = [];
      for (const vertex of folded.faces.flatMap((face) => face.vertices)) if (!unique.some((p) => distance(p, vertex.position) < 1e-7)) unique.push(vertex.position);
      expect(unique).toHaveLength(kind === "cuboid" ? 8 : 6);
      let volume = 0;
      for (const face of folded.faces) for (const [a, b, c] of face.triangleVertexIndices) volume += vector(face.vertices[a].position).dot(vector(face.vertices[b].position).cross(vector(face.vertices[c].position))) / 6;
      expect(Math.abs(volume)).toBeCloseTo(kind === "cuboid" ? 4 * 3 * 5 : 4 * 3 * 5 / 2, 10);
      expect(folded.bounds.min.x).toBeCloseTo(-2); expect(folded.bounds.max.x).toBeCloseTo(2);
      expect(folded.bounds.min.y).toBeCloseTo(0); expect(folded.bounds.max.y).toBeCloseTo(3);
      expect(folded.bounds.min.z).toBeCloseTo(-2.5); expect(folded.bounds.max.z).toBeCloseTo(2.5);
      expect(JSON.stringify(snapshot)).toBe(before);
      expect(solidNetsSnapshotSchema.safeParse(closed(snapshot)).success).toBe(true);
    });

    it(`${kind}: preserves every face and hinge during sequential intermediate frames`, () => {
      const snapshot = createDefaultSolidNetsSnapshot(kind), geometry = solidNetGeometry(kind, snapshot.dimensions), motion = solidNetAllMotion(snapshot, true);
      const middle = motion.sample(220);
      expect(middle.angles[geometry.hinges[0].id]).toBeCloseTo(geometry.hinges[0].closedDegrees / 2);
      expect(middle.angles[geometry.hinges[1].id]).toBe(0);
      for (let time = 0; time <= motion.durationMs; time += 137) {
        const rendered = resolveSolidNet(motion.sample(time));
        for (const face of geometry.faces) {
          const result = rendered.model.faces.find((entry) => entry.faceId === face.id)!;
          for (let index = 0; index < face.vertices.length; index++) {
            const next = (index + 1) % face.vertices.length;
            expect(distance(result.vertices[index].position, result.vertices[next].position)).toBeCloseTo(distance(face.vertices[index], face.vertices[next]), 9);
          }
        }
        for (const hinge of rendered.hinges) {
          for (const id of [hinge.parentFaceId, hinge.faceId]) {
            const vertices = rendered.model.faces.find((face) => face.faceId === id)!.vertices;
            expect(vertices.some((vertex) => distance(vertex.position, hinge.start) < 1e-7)).toBe(true);
            expect(vertices.some((vertex) => distance(vertex.position, hinge.end) < 1e-7)).toBe(true);
          }
        }
      }
      expect(motion.sample(motion.durationMs)).toEqual(motion.target);
    });

    it(`${kind}: either grabbed side may move without moving the supporting face`, () => {
      const initial = createDefaultSolidNetsSnapshot(kind), before = resolveSolidNet(initial);
      for (const face of before.model.faces) {
        const selection = cubeNetPaperSelection(face, before.model.faces, before.hinges, face.centroid)!.selection;
        const next: SolidNetsSnapshot = { ...initial, angles: { ...initial.angles, [selection.edgeId]: 37 }, anchor: { ...selection.anchor, vertices: [...selection.anchor.vertices] } };
        expect(solidNetsSnapshotSchema.safeParse(next).success).toBe(true);
        const after = resolveSolidNet(next);
        for (const id of before.model.faces.map((entry) => entry.faceId).filter((id) => !selection.movingFaceIds.includes(id))) {
          const original = before.model.faces.find((entry) => entry.faceId === id)!, current = after.model.faces.find((entry) => entry.faceId === id)!;
          expect(current.vertices.every((vertex, index) => distance(vertex.position, original.vertices[index].position) < 1e-7)).toBe(true);
        }
        expect(distance(after.model.faces.find((entry) => entry.faceId === face.faceId)!.centroid, face.centroid)).toBeGreaterThan(0.1);
      }
    });
  }
});

describe("solid-net strict preparation contract", () => {
  it("rejects missing/foreign hinges, surfaces, malformed anchors and out-of-range dimensions", () => {
    const value = createDefaultSolidNetsSnapshot();
    for (const change of [
      { angles: {} }, { angles: { ...value.angles, bogus: 0 } }, { angles: { ...value.angles, "base-left": 91 } }, { surfaces: {} },
      { dimensions: { ...value.dimensions, width: 0 } }, { dimensions: { ...value.dimensions, height: 8.1 } }, { dimensions: { ...value.dimensions, depth: Infinity } },
      { anchor: { faceId: "missing", vertices: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }] } },
      { anchor: { faceId: "base", vertices: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }] } },
      { question: "not a quiz" },
    ]) expect(solidNetsSnapshotSchema.safeParse({ ...value, ...change }).success).toBe(false);
    expect(solidNetsSnapshotSchema.safeParse({ ...value, surfaces: { ...value.surfaces, base: { ...value.surfaces.base, opacity: 0 } } }).success).toBe(true);
  });
  it("changes geometric dimensions without changing prepared face labels and colors", () => {
    const source = closed(createDefaultSolidNetsSnapshot("triangular-prism")); source.surfaces.front.label = "甲";
    const next = resizeSolidNet(source, { width: 6, height: 1, depth: 2 });
    expect(Object.values(next.angles).every((angle) => angle === 0)).toBe(true); expect(next.anchor).toBeNull(); expect(next.surfaces).toEqual(source.surfaces);
    expect(solidNetsSnapshotSchema.safeParse(closed(next)).success).toBe(true);
  });
});

describe("variable-angle direct paper gesture compatibility", () => {
  it("preserves the old cube's default 181 samples and ±90° snapping", () => {
    const initial = createDefaultSolidNetsSnapshot(), resolved = resolveSolidNet(initial), hinge = { ...resolved.hinges[0], minDegrees: undefined, maxDegrees: undefined };
    const face = resolved.model.faces.find((face) => face.faceId === hinge.faceId)!, project = (point: SolidNetPoint) => ({ x: point.x * 100, y: point.y * 100 });
    const drag = beginCubeNetFoldDrag(hinge, face.centroid, 0, project(face.centroid), project)!;
    expect(drag.samples).toHaveLength(181); expect(drag.samples[0].degrees).toBe(-90); expect(drag.samples.at(-1)!.degrees).toBe(90);
    expect([3, -3, 87, -88, 45, -35].map((angle) => finishCubeNetFoldDrag(angle))).toEqual([0, 0, 90, -90, 45, -35]);
  });
  it("can directly drag a prism beyond 90° and snap to its exact non-integer closing angle", () => {
    const initial = createDefaultSolidNetsSnapshot("triangular-prism", { width: 2, height: Math.sqrt(3), depth: 2 }), resolved = resolveSolidNet(initial);
    const hinge = resolved.hinges[0], face = resolved.model.faces.find((entry) => entry.faceId === hinge.faceId)!, project = (p: SolidNetPoint) => ({ x: p.x * 100, y: p.y * 100 });
    const drag = beginCubeNetFoldDrag(hinge, face.centroid, 0, project(face.centroid), project)!;
    expect(hinge.maxDegrees).toBeCloseTo(120);
    const target = drag.samples.at(-1)!;
    expect(updateCubeNetFoldDrag(drag, target.point, 110)).toBeCloseTo(120);
    expect(finishCubeNetFoldDrag(118, drag)).toBeCloseTo(120);
    const nonsymmetric = resolveSolidNet(createDefaultSolidNetsSnapshot("triangular-prism", { width: 3, height: 2, depth: 2 }));
    const variable = nonsymmetric.hinges[0];
    expect(variable.maxDegrees).not.toBe(120); expect(finishCubeNetFoldDrag(variable.maxDegrees! - 2, variable)).toBe(variable.maxDegrees);
  });
});

describe("snapshot-derived solid net motion", () => {
  it("unfolds one face at a time, then smoothly restores anchored paper onto X–Z", () => {
    const initial = createDefaultSolidNetsSnapshot(), resolved = resolveSolidNet(initial), face = resolved.model.faces[0];
    const anchor = cubeNetPaperSelection(face, resolved.model.faces, resolved.hinges, face.centroid)!.selection.anchor;
    const folded = { ...closed(initial), anchor: { ...anchor, vertices: [...anchor.vertices] } } as SolidNetsSnapshot;
    const motion = solidNetAllMotion(folded, false), first = motion.sample(220);
    expect(first.angles["front-top"]).toBeCloseTo(45); expect(first.angles["base-left"]).toBe(90);
    expect(motion.target.anchor).toBeNull(); expect(Object.values(motion.target.angles).every((angle) => angle === 0)).toBe(true);
    const end = resolveSolidNet(motion.sample(motion.durationMs)); expect(end.model.faces.flatMap((item) => item.vertices).every((v) => Math.abs(v.position.y) < 1e-8)).toBe(true);
    expect(solidNetsSnapshotSchema.safeParse(motion.sample(motion.durationMs - 200)).success).toBe(true);
  });
  it("reconstructs angle and placement transitions from durable states without frame storage", () => {
    const initial = createDefaultSolidNetsSnapshot("triangular-prism"), model = resolveSolidNet(initial), selected = cubeNetPaperSelection(model.model.faces[0], model.model.faces, model.hinges, model.model.faces[0].centroid)!.selection;
    const target: SolidNetsSnapshot = { ...initial, angles: { ...initial.angles, [selected.edgeId]: 60 }, anchor: { ...selected.anchor, vertices: [...selected.anchor.vertices] } };
    const transition = solidNetSnapshotTransition(initial, target)!;
    const first = resolveSolidNet(transition.sample(0)), last = resolveSolidNet(transition.sample(320));
    expect(transition.sample(160).angles[selected.edgeId]).toBeCloseTo(30);
    expect(first.model.faces.every((face, i) => face.vertices.every((vertex, j) => distance(vertex.position, model.model.faces[i].vertices[j].position) < 1e-8))).toBe(true);
    expect(last.model.faces).toEqual(resolveSolidNet(target).model.faces);
    expect(solidNetSnapshotTransition(initial, { ...initial, labelsVisible: false })).toBeNull();
    expect(solidNetSnapshotTransition(initial, createDefaultSolidNetsSnapshot())).toBeNull();
  });
});

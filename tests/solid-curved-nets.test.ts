import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { createCurvedNet, createDefaultSolidNetsComplete, curvedNetSnapshotSchema, solidNetsCompleteInitialSchema, solidNetsCompleteSnapshotSchema, solidNetsCompleteToolSchema, type CurvedNetSnapshot } from "@/features/tools/solid-nets/curved-contract";
import { conePaperPoint, curvedClosedProgress, curvedMotionOrder, curvedNetAt, curvedNetFrame, curvedPaperMesh, curvedPaperPoint, curvedParts, curvedSectorAngle, curvedSlant, cylinderPaperPoint } from "@/features/tools/solid-nets/curved-model";
import { solidNetsPolyhedraSnapshotSchema, solidNetsSnapshotSchema, solidNetsTeachingSnapshotSchema } from "@/features/tools/solid-nets/contract";
import { parameterAlongTrajectory } from "@/features/tools/spatial-interaction/parameter-trajectory";

const uuid = "0195cfe2-f015-4000-8000-000000000001";
function area(positions: number[]) {
  let total = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const a = new Vector3().fromArray(positions, i), b = new Vector3().fromArray(positions, i + 3), c = new Vector3().fromArray(positions, i + 6);
    total += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return total;
}
const distance = (left: Vector3, right: Vector3) => expect(left.distanceTo(right)).toBeLessThan(1e-8);

describe("isometric curved-paper construction", () => {
  it("lays the cylinder rectangle and cone sector on XZ with their actual material dimensions", () => {
    const cylinder = createCurvedNet("cylinder"), cone = createCurvedNet("cone");
    distance(cylinderPaperPoint(cylinder, 0, 0), new Vector3(-Math.PI, 0, -1.25));
    distance(cylinderPaperPoint(cylinder, 1, 1), new Vector3(Math.PI, 0, 1.25));
    expect(curvedSlant(cone)).toBeCloseTo(Math.hypot(1, 2.5));
    expect(curvedSectorAngle(cone) * curvedSlant(cone)).toBeCloseTo(2 * Math.PI * cone.radius);
    for (const s of [cylinder, cone]) for (const part of curvedParts(s)) {
      const mesh = curvedPaperMesh(s, part);
      expect(mesh.positions.every(Number.isFinite)).toBe(true);
      expect(mesh.positions.filter((_, index) => index % 3 === 1).every((y) => Math.abs(y) < 1e-12)).toBe(true);
    }
    let arcLength = 0;
    for (let i = 0; i < 1000; i++) arcLength += conePaperPoint(cone, i / 1000, 1).distanceTo(conePaperPoint(cone, (i + 1) / 1000, 1));
    expect(arcLength).toBeCloseTo(2 * Math.PI * cone.radius, 5);
  });
  it.each(["cylinder", "cone"] as const)("preserves the %s material metric at every intermediate rolling angle", (kind) => {
    for (const [radius, height] of [[1, 2.5], [0.25, 8], [4, 0.25]]) {
      const source = { ...createCurvedNet(kind), radius, height }, f = kind === "cone" ? conePaperPoint : cylinderPaperPoint, epsilon = 1e-6;
      for (const roll of [0, 0.1, 0.35, 0.75, 1]) for (const u of [0.15, 0.5, 0.82]) for (const v of [0.1, 0.55, 0.9]) {
        const du = f(source, u + epsilon, v, roll).sub(f(source, u - epsilon, v, roll)).divideScalar(2 * epsilon);
        const dv = f(source, u, v + epsilon, roll).sub(f(source, u, v - epsilon, roll)).divideScalar(2 * epsilon);
        expect(du.length()).toBeCloseTo(2 * Math.PI * radius * (kind === "cone" ? v : 1), 5);
        expect(dv.length()).toBeCloseTo(kind === "cone" ? curvedSlant(source) : height, 5);
        expect(du.dot(dv)).toBeCloseTo(0, 5);
      }
    }
  });
  it.each(["cylinder", "cone"] as const)("closes the %s seam and joins each base circle to the same side boundary", (kind) => {
    const source = createCurvedNet(kind); source.progress = curvedClosedProgress(source);
    for (const v of [0, 0.1, 0.5, 1]) distance(curvedPaperPoint(source, "side", 0, v), curvedPaperPoint(source, "side", 1, v));
    for (const u of [0, 0.125, 0.25, 0.4, 0.75, 1]) {
      if (kind === "cylinder") {
        distance(curvedPaperPoint(source, "side", u, 0), curvedPaperPoint(source, "lower", (u + 0.5) % 1, 1));
        distance(curvedPaperPoint(source, "side", u, 1), curvedPaperPoint(source, "upper", 1 - u, 1));
      } else distance(curvedPaperPoint(source, "side", u, 1), curvedPaperPoint(source, "lower", 1 - u, 1));
    }
  });
  it.each(["cylinder", "cone"] as const)("keeps the %s base pivot linked throughout independently controlled partial folding", (kind) => {
    const source = createCurvedNet(kind);
    for (const roll of [0, 0.2, 0.6, 1]) for (const cap of [0, 0.3, 0.8, 1]) {
      source.progress = { side: roll, lower: cap, upper: kind === "cone" ? 0 : 1 - cap };
      if (kind === "cylinder") {
        distance(curvedPaperPoint(source, "side", 0.5, 0), curvedPaperPoint(source, "lower", 0, 1));
        distance(curvedPaperPoint(source, "side", 0.5, 1), curvedPaperPoint(source, "upper", 0.5, 1));
      } else distance(curvedPaperPoint(source, "side", 0.5, 1), curvedPaperPoint(source, "lower", 0.5, 1));
    }
  });
  it.each(["cylinder", "cone"] as const)("preserves %s surface area between the planar net and closed mesh", (kind) => {
    const source = createCurvedNet(kind), expected = 2 * Math.PI * source.radius * (kind === "cylinder" ? source.height + source.radius : (curvedSlant(source) + source.radius) / 2);
    for (const roll of [0, 0.5, 1]) {
      source.progress = { side: roll, lower: roll, upper: kind === "cone" ? 0 : roll };
      const actual = curvedParts(source).reduce((total, part) => total + area(curvedPaperMesh(source, part, 360).positions), 0);
      expect(actual / expected).toBeCloseTo(1, 4);
      const side = curvedPaperMesh(source, "side");
      expect(side.uv.length / 2).toBe(side.positions.length / 3);
      expect(side.linkedEdges).toHaveLength(kind === "cylinder" ? 2 : 1);
    }
  });
});

describe("curved teaching motion and compatibility", () => {
  it("keeps the whole process inside one stable framing range even for shallow cones", () => {
    for (const kind of ["cone", "cylinder"] as const) for (const [radius, height] of [[0.25, 8], [4, 0.25], [1, 2.5]]) {
      const state = { ...createCurvedNet(kind), radius, height }, frame = curvedNetFrame(kind, radius, height), center = new Vector3(frame.center.x, frame.center.y, frame.center.z);
      for (const part of curvedParts(state)) for (const q of [0, 0.03, 0.18, 0.59, 0.82, 1]) for (let u = 0; u <= 40; u++) {
        expect(curvedPaperPoint(state, part, u / 40, 1, q).distanceTo(center)).toBeLessThanOrEqual(frame.radius);
      }
    }
  });
  it("folds the side before bases and unfolds bases before the side, retaining exact intermediate frames", () => {
    const flat = createCurvedNet("cylinder"), closed = curvedClosedProgress(flat);
    const folding: CurvedNetSnapshot = { ...flat, progress: closed, motion: { id: uuid, from: flat.progress, startedAt: 1000, durationMs: 3000 } };
    expect(curvedMotionOrder(flat.progress, closed)).toEqual(["side", "lower", "upper"]);
    expect(curvedNetAt(folding, 1500).progress).toEqual({ side: 0.5, lower: 0, upper: 0 });
    expect(curvedNetAt(folding, 2500).progress).toEqual({ side: 1, lower: 0.5, upper: 0 });
    expect(curvedNetAt(folding, 3500).progress).toEqual({ side: 1, lower: 1, upper: 0.5 });
    expect(curvedNetAt(folding, 4000)).toEqual({ ...folding, motion: null });
    const unfolding: CurvedNetSnapshot = { ...flat, motion: { id: uuid, from: closed, startedAt: 1000, durationMs: 3000 } };
    expect(curvedMotionOrder(closed, flat.progress)).toEqual(["upper", "lower", "side"]);
    expect(curvedNetAt(unfolding, 1500).progress).toEqual({ side: 1, lower: 1, upper: 0.5 });
    expect(curvedNetAt(unfolding, 2500).progress).toEqual({ side: 1, lower: 0.5, upper: 0 });
    expect(curvedNetAt(unfolding, 3500).progress).toEqual({ side: 0.5, lower: 0, upper: 0 });
    expect(curvedNetAt(unfolding, 4000)).toEqual(flat);
  });
  it("late joins, pause snapshots and continued commands reconstruct the same accepted frame without replay", () => {
    const flat = createCurvedNet("cone"), command: CurvedNetSnapshot = { ...flat, progress: curvedClosedProgress(flat), motion: { id: uuid, from: flat.progress, startedAt: 1000, durationMs: 2000 } };
    expect(curvedNetAt(command, 1500).progress).toEqual({ side: 0.5, lower: 0, upper: 0 });
    const paused = curvedNetAt(command, 2250);
    expect(curvedNetAt(structuredClone(command), 2250)).toEqual(paused);
    expect(curvedNetAt(paused, 99999)).toBe(paused); expect(paused.motion).toBeNull();
    const resumed: CurvedNetSnapshot = { ...command, motion: { ...command.motion!, from: paused.progress, startedAt: 4000, durationMs: 1000 } };
    expect(curvedNetAt(resumed, 4000).progress).toEqual(paused.progress);
    expect(curvedNetAt(resumed, 5000).progress).toEqual(command.progress);
    expect(curvedParts(command)).toEqual(["side", "lower"]);
  });
  it("strictly versions prepared shapes without widening any previous solid-net schema", () => {
    const initial = createCurvedNet("cone"), prepared = { mode: "curved", data: initial };
    expect(solidNetsCompleteSnapshotSchema.safeParse(prepared).success).toBe(true);
    expect(solidNetsCompleteInitialSchema.safeParse(createDefaultSolidNetsComplete()).success).toBe(true);
    expect(solidNetsCompleteToolSchema.safeParse({ toolId: "solid-nets", contentVersion: "solid-nets-lesson-v3", payload: { title: "Cone", initial: prepared } }).success).toBe(true);
    for (const legacy of [solidNetsSnapshotSchema, solidNetsTeachingSnapshotSchema, solidNetsPolyhedraSnapshotSchema]) expect(legacy.safeParse(initial).success).toBe(false);
    const playing = { ...initial, progress: { side: 1, lower: 1, upper: 0 }, motion: { id: uuid, from: initial.progress, startedAt: 1000, durationMs: 2000 } };
    expect(solidNetsCompleteSnapshotSchema.safeParse({ mode: "curved", data: playing }).success).toBe(true);
    expect(solidNetsCompleteInitialSchema.safeParse({ mode: "curved", data: playing }).success).toBe(false);
    for (const patch of [{ radius: 0 }, { radius: Infinity }, { height: 8.1 }, { kind: "sphere" }, { version: "solid-nets-v3" }, { progress: { side: 0, lower: 0, upper: 1 } }, { score: 5 }, { surfaces: { ...initial.surfaces, side: { color: "red", opacity: 0.5 } } }]) expect(curvedNetSnapshotSchema.safeParse({ ...initial, ...patch }).success).toBe(false);
    expect(curvedNetSnapshotSchema.safeParse({ ...playing, motion: { ...playing.motion, from: { side: 0, lower: 0, upper: 1 } } }).success).toBe(false);
    expect(curvedNetSnapshotSchema.safeParse({ ...playing, motion: { ...playing.motion, durationMs: 0 } }).success).toBe(false);
  });
});

describe("shared local material-point trajectory", () => {
  const circle = (v: number) => ({ x: 100 * Math.cos(2 * Math.PI * v), y: 100 * Math.sin(2 * Math.PI * v) });
  it("keeps degenerate or unchanged trajectories at the exact previous value", () => {
    for (const previous of [0.01, 0.025, 0.1, 0.7, 0.975, 0.99]) {
      expect(parameterAlongTrajectory(() => ({ x: 10, y: 20 }), { x: 10, y: 20 }, previous)).toBe(previous);
      expect(parameterAlongTrajectory(circle, circle(previous), previous)).toBe(previous);
    }
  });
  it("stays on the nearby branch, follows either direction and clamps the endpoint", () => {
    expect(parameterAlongTrajectory(circle, circle(0.99), 0.95)).toBeCloseTo(0.99, 2);
    expect(parameterAlongTrajectory(circle, circle(0.98), 0.02)).toBeLessThan(0.05);
    expect(parameterAlongTrajectory(circle, circle(0.02), 0.98)).toBeGreaterThan(0.95);
    const line = (v: number) => ({ x: v * 300, y: v * 60 });
    let previous = 0.2;
    for (const expected of [0.35, 0.5, 0.65, 0.8, 0.95, 1]) {
      previous = parameterAlongTrajectory(line, line(1), previous); expect(previous).toBeCloseTo(expected, 6);
    }
    expect(parameterAlongTrajectory(line, line(0), 0.05)).toBe(0);
    expect(parameterAlongTrajectory(line, line(0.4), 0.5)).toBeCloseTo(0.4, 2);
  });
});

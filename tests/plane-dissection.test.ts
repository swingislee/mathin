import { describe, expect, it } from "vitest";
import { planePointFromClient, polygonArea, translatePolygon } from "@/features/tools/planar-interaction/geometry";
import { closestPaperSnap, commitPaperScene, defaultPlaneDissection, interpolatePaperScene, movePaper, paperPolygons, planeDissectionSchema, stepPaperHistory, type PaperHistory } from "@/features/tools/plane-dissection/model";
import { LOCAL_PLANE_WORKBENCH_SYNC_PROVIDERS } from "@/features/classroom/sync/interaction-audit";

describe("parallelogram dissection model", () => {
  it("preserves exact total area over the supported dimensions and every translation", () => {
    for (const base of [3, 6, 8]) for (const height of [1.5, 3, 5]) for (const slant of [.5, 1.5, 2.5]) {
      const polygons = paperPolygons({ ...defaultPlaneDissection(), base, height, slant });
      expect(polygonArea(polygons.whole)).toBeCloseTo(base * height);
      expect(polygonArea(polygons.body) + polygonArea(polygons.offcut)).toBeCloseTo(base * height);
      expect(polygonArea(translatePolygon(polygons.offcut, { x: 8.91, y: -2.7 }))).toBeCloseTo(slant * height / 2);
    }
  });
  it("lets either paper move freely in both planar directions and reach the rectangle", () => {
    const initial = { ...defaultPlaneDissection(), cut: true };
    const moved = movePaper(initial, "offcut", { x: 6, y: 1.2 });
    expect(moved.offcut).toEqual({ x: 6, y: 1.2 });
    const joined = movePaper(moved, "offcut", { x: 0, y: -1.2 });
    expect(closestPaperSnap(joined, "offcut", .3)).toEqual({ kind: "rectangle", position: { x: 6, y: 0 } });
    const polygons = paperPolygons(joined);
    const outline = [...polygons.body, ...translatePolygon(polygons.offcut, joined.offcut)];
    expect(Math.max(...outline.map((p) => p.x)) - Math.min(...outline.map((p) => p.x))).toBe(6);
    expect(closestPaperSnap(joined, "body", .3)).toEqual({ kind: "rectangle", position: { x: 0, y: 0 } });
  });
  it("only offers nearby joins when snapping is explicitly enabled", () => {
    const scene = { ...defaultPlaneDissection(), cut: true, offcut: { x: 5.8, y: .1 } };
    expect(closestPaperSnap(scene, "offcut", .3)?.kind).toBe("rectangle");
    expect(closestPaperSnap(scene, "offcut", .1)).toBeNull();
    expect(closestPaperSnap({ ...scene, snap: false }, "offcut", 10)).toBeNull();
    expect(closestPaperSnap({ ...scene, cut: false }, "offcut", 10)).toBeNull();
  });
  it("uses intermediate display frames and one undoable authoritative endpoint", () => {
    const from = { ...defaultPlaneDissection(), cut: true }, to = { ...from, offcut: { x: 6, y: 0 } };
    expect(interpolatePaperScene(from, to, .5).offcut.x).toBe(3);
    expect(interpolatePaperScene(from, to, 1)).toEqual(to);
    const first: PaperHistory = { past: [], present: from, future: [] };
    const committed = commitPaperScene(first, to);
    expect(committed.past).toHaveLength(1);
    expect(commitPaperScene(committed, to)).toBe(committed);
    expect(stepPaperHistory(stepPaperHistory(committed, "undo"), "redo").present).toEqual(to);
    const restore = interpolatePaperScene(to, { ...from, cut: false }, .5);
    expect(restore.cut).toBe(true);
    expect(restore.offcut.x).toBe(3);
  });
  it("locks a valid screen-to-plane transform without assuming secure browser APIs", () => {
    expect(planePointFromClient({ x: 125, y: 100 }, { a: .5, b: 0, c: 0, d: .5, e: 25, f: 50 })).toEqual({ x: 200, y: 100 });
    expect(planePointFromClient({ x: 1, y: 1 }, { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 })).toBeNull();
  });
  it("round-trips exact snapshots and keeps the local preview outside classroom writeback", () => {
    const initial = defaultPlaneDissection();
    expect(planeDissectionSchema.parse(JSON.parse(JSON.stringify(initial)))).toEqual(initial);
    expect(planeDissectionSchema.safeParse({ ...initial, base: NaN }).success).toBe(false);
    expect(planeDissectionSchema.safeParse({ ...initial, hover: true }).success).toBe(false);
    expect(LOCAL_PLANE_WORKBENCH_SYNC_PROVIDERS[initial.version].mode).toBe("read-only");
  });
});

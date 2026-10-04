import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlanarPoint as Point, PlanarState } from "@/features/tools/planar-kit/contract";
import type { PlanarDrawingApi } from "@/features/tools/planar-kit/types";
import { constructionArea, constructionObject, constructionObjects, isSimpleConstructionPolygon, worldVertices } from "@/features/tools/plane-construction/model";
import { isConvexMaterial } from "@/features/tools/plane-relations/geometry";
import { concaveRegions, concaveRegionsArea, concaveSignedArea, triangulateConcavePolygon } from "@/features/tools/plane-overlap/concave-geometry";
import { addConcaveOverlapMaterial, assignConcaveOverlap, concaveOverlapModel, createConcaveOverlapGeometry, createConcaveOverlapState, dragConcaveOverlap, setConcaveOverlapField } from "@/features/tools/plane-overlap/concave-model";
import { planeConcaveOverlapScene } from "@/features/tools/plane-overlap/concave-scene";
import { isValidConcaveOverlapState } from "@/features/tools/plane-overlap/concave-validation";
import { createOverlapState } from "@/features/tools/plane-overlap/model";
import { isValidOverlapState } from "@/features/tools/plane-overlap/validation";
import { planeOverlapConcaveCases } from "./fixtures/plane-overlap-concave-cases";

const rectangle = (x: number, y: number, width: number, height = width): Point[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
const lPaper: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 100 }, { x: 0, y: 100 }];
const uPaper: Point[] = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 70 }, { x: 70, y: 70 }, { x: 70, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
const shifted = (points: readonly Point[], x: number, y: number) => points.map((point) => ({ x: point.x + x, y: point.y + y }));
const action = (id: string) => [...planeConcaveOverlapScene.actions!, ...planeConcaveOverlapScene.operations!.flatMap((operation) => operation.actions ?? [])].find((entry) => entry.id === id)!;
const context = { selected: null };
const valid = (state: PlanarState) => expect(isValidConcaveOverlapState(state)).toBe(true);
function inside(points: readonly Point[], at: Point) {
  let value = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > at.y) !== (b.y > at.y) && at.x < (b.x - a.x) * (at.y - a.y) / (b.y - a.y) + a.x) value = !value;
  }
  return value;
}
const covered = (pieces: readonly Point[][], at: Point) => pieces.some((piece) => inside(piece, at));
// 独立 Sutherland–Hodgman 测试 oracle 不沿用旧固定叉积 EPS，微小计算片也有有效半平面。
function convexOverlapArea(first: Point[], second: Point[]) {
  let result = first;
  for (let index = 0; index < second.length; index++) {
    const a = second[index], b = second[(index + 1) % second.length];
    const distance = (p: Point) => ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
    const clipped: Point[] = [];
    for (let j = 0; j < result.length; j++) {
      const previous = result[(j + result.length - 1) % result.length], current = result[j], p = distance(previous), q = distance(current);
      if ((p >= 0) !== (q >= 0)) clipped.push({ x: previous.x + (current.x - previous.x) * p / (p - q), y: previous.y + (current.y - previous.y) * p / (p - q) });
      if (q >= 0) clipped.push(current);
    }
    result = clipped;
  }
  return Math.abs(concaveSignedArea(result));
}
function checkRegions(a: Point[], b: Point[], disjoint = true) {
  const result = concaveRegions(a, b)!; expect(result).not.toBeNull();
  expect(concaveRegionsArea(result.intersection) + concaveRegionsArea(result.difference)).toBeCloseTo(constructionArea(a), 6);
  expect(concaveRegionsArea(result.union) + concaveRegionsArea(result.intersection)).toBeCloseTo(constructionArea(a) + constructionArea(b), 6);
  for (const pieces of [result.intersection, result.difference, result.union]) {
    expect(pieces.every((piece) => concaveSignedArea(piece) > 0 && piece.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))).toBe(true);
    if (disjoint) pieces.forEach((first, index) => pieces.slice(index + 1).forEach((second) => expect(convexOverlapArea(first, second), JSON.stringify({ first, second })).toBeLessThan(1e-6)));
  }
  return result;
}

describe("exact straight-edge concave regions", () => {
  it("triangulates both windings, retains collinear edit points in the input and conserves area", () => {
    const collinear = [lPaper[0], { x: 50, y: 0 }, ...lPaper.slice(1)];
    for (const shape of [lPaper, uPaper, collinear]) for (const input of [shape, [...shape].reverse()]) {
      const before = JSON.stringify(input), triangles = triangulateConcavePolygon(input)!;
      expect(triangles.length).toBeLessThanOrEqual(input.length - 2);
      expect(concaveRegionsArea(triangles)).toBeCloseTo(constructionArea(input), 8);
      expect(triangles.every((triangle) => triangle.length === 3 && concaveSignedArea(triangle) > 0)).toBe(true);
      expect(JSON.stringify(input)).toBe(before);
      checkRegions(input, shifted(uPaper, 20, 10));
    }
  });

  it("retains holes and separate intersection/difference regions without filling concave notches", () => {
    const hole = checkRegions(uPaper, rectangle(5, 15, 15, 30));
    expect(concaveRegionsArea(hole.difference)).toBe(6750);
    expect(covered(hole.difference, { x: 10.2, y: 20.3 })).toBe(false);
    expect(covered(hole.union, { x: 50.2, y: 20.3 })).toBe(false);
    const bridge = checkRegions(uPaper, rectangle(-10, 20, 120, 30));
    expect(concaveRegionsArea(bridge.intersection)).toBe(1800);
    expect(covered(bridge.intersection, { x: 10.2, y: 30.3 })).toBe(true);
    expect(covered(bridge.intersection, { x: 80.2, y: 30.3 })).toBe(true);
    expect(covered(bridge.intersection, { x: 50.2, y: 30.3 })).toBe(false);
    const split = checkRegions(lPaper, rectangle(10, -10, 10, 120));
    expect(concaveRegionsArea(split.difference)).toBeCloseTo(4100, 8);
    expect(covered(split.difference, { x: 5.2, y: 50.3 })).toBe(true);
    expect(covered(split.difference, { x: 25.2, y: 50.3 })).toBe(true);
    expect(covered(split.difference, { x: 15.2, y: 50.3 })).toBe(false);
  });

  it("keeps shared edges, point contacts, disjoint inputs and identical concave outlines finite", () => {
    for (const b of [shifted(lPaper, 100, 0), shifted(lPaper, 100, 100), shifted(lPaper, 150, 150)]) {
      const regions = checkRegions(lPaper, b);
      expect(regions.intersection).toEqual([]); expect(concaveRegionsArea(regions.difference)).toBe(5100);
    }
    const same = checkRegions(uPaper, [...uPaper].reverse());
    expect(same.difference).toEqual([]); expect(concaveRegionsArea(same.intersection)).toBe(7200); expect(concaveRegionsArea(same.union)).toBe(7200);
    const contained = checkRegions(lPaper, rectangle(-10, -10, 120)); expect(contained.difference).toEqual([]);
    const aligned = checkRegions(lPaper, rectangle(30, 30, 40)); expect(aligned.intersection).toEqual([]);
  });

  it("preserves a real positive-area overlap much smaller than the legacy fixed area cutoff", () => {
    const x = 100 - 1e-10, result = concaveRegions(lPaper, rectangle(x, -10, 100, 50))!;
    const area = concaveRegionsArea(result.intersection), expected = (100 - x) * 30;
    expect(area).toBeGreaterThan(0); expect(area).toBeLessThan(1e-7); expect(Math.abs(area - expected) / expected).toBeLessThan(0.001);
  });

  it("is winding and pose invariant for concave pairs, including nearly parallel boundaries", () => {
    for (const degrees of [1e-9, 17, 45, 89.99999999, 137, 180]) for (const offset of [-150, -20, 0, 25, 150]) {
      const angle = degrees * Math.PI / 180;
      const b = shifted(uPaper.map((point) => ({ x: point.x * Math.cos(angle) - point.y * Math.sin(angle), y: point.x * Math.sin(angle) + point.y * Math.cos(angle) })), offset, 25);
      const regions = checkRegions(lPaper, b), reverse = checkRegions([...b].reverse(), [...lPaper].reverse());
      expect(concaveRegionsArea(regions.intersection)).toBeCloseTo(concaveRegionsArea(reverse.intersection), 6);
      expect(concaveRegionsArea(regions.union)).toBeCloseTo(concaveRegionsArea(reverse.union), 6);
    }
  });

  it("agrees with an independent exact cell oracle over varied orthogonal concave pairs", () => {
    const hist = (heights: number[]): Point[] => {
      const points = [{ x: 0, y: 0 }, { x: heights.length, y: 0 }, { x: heights.length, y: heights.at(-1)! }];
      for (let index = heights.length - 1; index > 0; index--) points.push({ x: index, y: heights[index] }, { x: index, y: heights[index - 1] });
      points.push({ x: 0, y: heights[0] }); return points;
    };
    for (let seed = 1; seed <= 18; seed++) {
      const a = hist(Array.from({ length: 7 }, (_, index) => 2 + ((index * 3 + seed) % 5)));
      const b = shifted(hist(Array.from({ length: 6 }, (_, index) => 2 + ((index * 4 + seed * 3) % 7))).map((point) => ({ x: point.y, y: point.x })), -2 + seed % 4, -1 + seed % 3);
      const result = checkRegions(a, b), counts = { intersection: 0, difference: 0, union: 0 };
      for (let x = -3; x < 11; x++) for (let y = -2; y < 11; y++) {
        const point = { x: x + 0.5, y: y + 0.5 }, inA = inside(a, point), inB = inside(b, point);
        counts.intersection += Number(inA && inB); counts.difference += Number(inA && !inB); counts.union += Number(inA || inB);
      }
      for (const key of ["intersection", "difference", "union"] as const) expect(concaveRegionsArea(result[key])).toBeCloseTo(counts[key], 8);
    }
  });

  it("bounds maximum-32-point concave pairs through repeated drag poses without runaway fragments", () => {
    const star = (phase: number) => Array.from({ length: 32 }, (_, index) => {
      const angle = phase + index * Math.PI / 16, radius = index % 2 ? 60 : 170;
      return { x: 450 + radius * Math.cos(angle), y: 350 + radius * Math.sin(angle) };
    });
    const start = performance.now(), first = star(0); let maxPieces = 0;
    expect(isSimpleConstructionPolygon(first)).toBe(true);
    for (let step = 0; step < 16; step++) {
      const second = shifted(star(Math.PI / 32 + step * 0.003), step - 8, 4);
      const regions = checkRegions(first, second, false);
      maxPieces = Math.max(maxPieces, ...[regions.intersection, regions.difference, regions.union].map((region) => region.length));
    }
    expect(maxPieces).toBeLessThan(2000); expect(performance.now() - start).toBeLessThan(5000);
  });
});

describe("concave paper state and descriptors", () => {
  it("starts with a concave paper and keeps v2 strictly separate", () => {
    const start = createConcaveOverlapState(); valid(start);
    expect(isConvexMaterial(constructionObject(start, start.params.pairA)!.vertices)).toBe(false);
    expect(isValidOverlapState(start)).toBe(false); expect(isValidOverlapState({ ...start, sceneId: "33-create" })).toBe(false);
    expect(isValidConcaveOverlapState(createOverlapState())).toBe(false); expect(isValidOverlapState(createOverlapState())).toBe(true);
  });

  it("adds, draws, copies and edits real concave paper while retaining A/B until explicit assignment", () => {
    let state = createConcaveOverlapState(); const before = concaveOverlapModel(state)!;
    state = addConcaveOverlapMaterial(state, "u-paper"); valid(state);
    state = createConcaveOverlapGeometry(state, "polygon", shifted(lPaper, 650, 300))!; valid(state);
    state = action("construction-duplicate").run(state, context); valid(state);
    expect(concaveOverlapModel(state)).toEqual(before);
    const newId = state.params.active; state = assignConcaveOverlap(state, "pairA"); valid(state); expect(state.params.pairA).toBe(newId);
    expect(assignConcaveOverlap(state, "pairB")).toBe(state);
    state = { ...state, flags: { ...state.flags, edit: true } };
    const a = worldVertices(constructionObject(state)!)[3];
    state = dragConcaveOverlap(state, `vertex.${newId}.3`, a, { x: 10, y: 10 }); valid(state);
    expect(concaveOverlapModel(state)!.a[3].x).toBeCloseTo(a.x + 10, 8);
    const edited = concaveOverlapModel(state)!;
    state = action("construction-insert-vertex").run(state, { selected: `edge.${newId}.0` }); valid(state);
    expect(concaveOverlapModel(state)!.areaA).toBeCloseTo(edited.areaA, 8);
    state = action("construction-remove-vertex").run(state, { selected: `vertex.${newId}.1` }); valid(state);
    expect(concaveOverlapModel(state)!.areaA).toBeCloseTo(edited.areaA, 8);
  });

  it("clears only deleted pair slots and rejects invalid construction/edits atomically", () => {
    let state = setConcaveOverlapField(createConcaveOverlapState(), "region", 3); const a = state.params.pairA;
    state = action("construction-remove").run(state, context); valid(state); expect(state.params.pairB).toBe(-1); expect(state.params.pairA).toBe(a);
    state = addConcaveOverlapMaterial(state, "u-paper"); valid(state); expect(state.params.pairB).toBe(-1);
    state = assignConcaveOverlap(state, "pairB"); valid(state); expect(state.params.region).toBe(3);
    expect(createConcaveOverlapGeometry(state, "circle", [{ x: 0, y: 0 }, { x: 30, y: 30 }])).toBeNull();
    expect(createConcaveOverlapGeometry(state, "polygon", [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }])).toBeNull();
    const editing = { ...state, flags: { ...state.flags, edit: true } }, points = worldVertices(constructionObject(editing)!);
    expect(dragConcaveOverlap(editing, `vertex.${editing.params.active}.0`, points[0], { x: points[1].x - points[0].x, y: points[1].y - points[0].y })).toBe(editing);
  });

  it("keeps real rotate/reflect endpoints saveable and projection frames out of region math", () => {
    const from = setConcaveOverlapField(createConcaveOverlapState(), "region", 1);
    for (const id of ["construction-rotate", "construction-reflect"]) {
      const command = action(id), to = command.run(from, context); valid(to); expect(to).not.toEqual(from);
      for (const fraction of [0.25, 0.5, 0.75]) {
        const frame = command.interpolate!(from, to, fraction), model = concaveOverlapModel(frame);
        if (id.endsWith("reflect")) { expect(isValidConcaveOverlapState(frame)).toBe(false); expect(model).toBeNull(); }
        else { valid(frame); expect(model!.differenceArea + model!.intersectionArea).toBeCloseTo(model!.areaA, 7); }
      }
      const restored = JSON.parse(JSON.stringify(to)); valid(restored); expect(concaveOverlapModel(restored)).toEqual(concaveOverlapModel(to));
      expect(action("construction-reflect").interpolate!(from, to, 1)).toEqual(to);
    }
    expect(Object.keys(from.params).some((key) => /Area|area|intersection|union/.test(key))).toBe(false);
  });

  it("reuses single-path region filling, labels, observations and the nearby reflection operation", () => {
    const state = { ...setConcaveOverlapField(createConcaveOverlapState(), "region", 3), flags: { ...createConcaveOverlapState().flags, measures: true } };
    const api: PlanarDrawingApi = { locale: "en", selected: `object.${state.params.active}`, editable: true,
      bind: (_target, label = "") => ({ role: "button", tabIndex: 0, "aria-label": label, "aria-pressed": false, "aria-disabled": false }) };
    const markup = renderToStaticMarkup(planeConcaveOverlapScene.draw(state, api));
    expect(markup).toContain('data-overlap-region="3"'); expect(markup).toContain('fill-rule="nonzero" stroke="none"'); expect(markup).toContain('data-overlap-measures="true"');
    expect(markup.match(/data-overlap-region/g)).toHaveLength(1); expect(markup).not.toContain("clipPath");
    const near = planeConcaveOverlapScene.contextActions!(state, `object.${state.params.active}`)!;
    expect(near.items.map((entry) => entry.id)).toEqual(["regions", "construction-edit", "rotate", "reflect", "construction-duplicate"]);
  });

  it("matches shared strict fixtures, including all limits and both version impersonations", () => {
    for (const fixture of planeOverlapConcaveCases()) {
      const accepted = fixture.scene.contentVersion === "plane-overlap-lesson-v3" && isValidConcaveOverlapState(fixture.scene.payload.initial);
      expect(accepted, fixture.label).toBe(fixture.accepted);
      if (fixture.accepted) expect(isValidConcaveOverlapState(JSON.parse(JSON.stringify(fixture.scene.payload.initial)))).toBe(true);
    }
    const full = planeOverlapConcaveCases().find((entry) => entry.label === "capacity-16-papers-192-points")!.scene.payload.initial;
    expect(constructionObjects(full)).toHaveLength(16); expect(addConcaveOverlapMaterial(full, "triangle")).toBe(full);
  });

  it("adds only private v3 SQL helpers with strict shells and inherited simple-material validation", () => {
    const sql = readFileSync("supabase/migrations/20261004020000_tool_plane_overlap_concave.sql", "utf8");
    for (const scope of ["state", "scene"]) {
      const name = `public.tool_plane_overlap_concave_${scope}_is_valid`;
      expect(sql).toContain(`create function ${name}(s jsonb)`); expect(sql).toContain(`revoke all on function ${name}(jsonb) from public,anon,authenticated,service_role;`);
    }
    expect(sql).toContain("'plane-overlap-lesson-v3'"); expect(sql).toContain("'33-concave'"); expect(sql).toContain("public.tool_plane_construction_state_is_valid(base_state)");
    expect(sql.match(/exception when others then return false/g)).toHaveLength(2);
    expect(sql).not.toContain("create or replace"); expect(sql).not.toContain("tool_scene_is_valid");
  });
});

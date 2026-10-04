import { describe, expect, it } from "vitest";
import type { PlanarState } from "@/features/tools/planar-kit/contract";
import { booleanRegions, cutRegion, regionComponents } from "@/features/tools/plane-overlap-curves/boolean";
import { circleRegion, locatePoint, loopArea, polygonRegion, regionArea, regionEdges, regionPath, regionPerimeter, transformRegion, type CurveRegion } from "@/features/tools/plane-overlap-curves/geometry";
import { circleIntersections, edgeIntersections } from "@/features/tools/plane-overlap-curves/intersections";
import { activateCurveMaterial, addCurveMaterial, addSquareForCircle, assignCurvePair, createCurveGeometry, createCurveOverlapState, curveMaterial, curveMaterials, curveOverlapModel, curveWorldRegion, dragCurveMaterial, duplicateCurveMaterial, extractCurveRegion, extractLeafSegments, interpolateCurvePose, moveCurveAside, reflectCurveMaterial, removeCurveMaterial, returnCurveMaterial, rotateCurveMaterial, setCurveField, splitCurveMaterial } from "@/features/tools/plane-overlap-curves/model";
import { writeCurveMaterials } from "@/features/tools/plane-overlap-curves/state";
import { isValidCurveOverlapState, isValidCurveRegion } from "@/features/tools/plane-overlap-curves/validation";
import { planeOverlapCurvesCases } from "./fixtures/plane-overlap-curves-cases";

const c = (x: number, y: number, radius: number) => circleRegion({ x, y }, radius);
const polygon = (points: number[][]) => polygonRegion(points.map(([x, y]) => ({ x, y })));
const square = (size: number) => polygon([[-size, -size], [size, -size], [size, size], [-size, size]]);
const empty = () => removeCurveMaterial(removeCurveMaterial(createCurveOverlapState()));
const pair = (state: PlanarState, first: number, second: number): PlanarState => ({ ...state, params: { ...state.params, pairA: first, pairB: second } });
const positiveRegion = (region: CurveRegion | null) => { expect(region).not.toBeNull(); expect(isValidCurveRegion(region!, true)).toBe(true); return region!; };
function identity(a: CurveRegion, b: CurveRegion) {
  const intersection = positiveRegion(booleanRegions(a, b, "intersection")), union = positiveRegion(booleanRegions(a, b, "union")), difference = positiveRegion(booleanRegions(a, b, "difference"));
  expect(regionArea(union)).toBeCloseTo(regionArea(a) + regionArea(b) - regionArea(intersection), 7);
  expect(regionArea(difference) + regionArea(intersection)).toBeCloseTo(regionArea(a), 7);
  return { intersection, union, difference };
}

describe("real directed segment and circular-arc regions", () => {
  it("starts with editable papers, exact circles and observations off", () => {
    const state = createCurveOverlapState();
    expect(isValidCurveOverlapState(state)).toBe(true);
    expect(curveMaterials(state).map((material) => material.kind)).toEqual([0, 1]);
    expect(Object.values(state.flags).every((flag) => !flag)).toBe(true);
    const circle = curveMaterial(state, 1)!;
    expect(regionEdges(circle.region)).toHaveLength(2);
    expect(regionPath(circle.region).match(/A /g)).toHaveLength(2);
    expect(regionArea(circle.region)).toBeCloseTo(Math.PI * 120 ** 2, 9);
    expect(regionPerimeter(circle.region)).toBeCloseTo(Math.PI * 240, 9);
  });

  it("uses analytic line-circle and circle-circle intersections", () => {
    const first = c(0, 0, 100), second = c(100, 0, 100);
    expect(circleIntersections(first.loops[0][0].circle!, second.loops[0][0].circle!)).toEqual([{ x: 50, y: Math.sqrt(7500) }, { x: 50, y: -Math.sqrt(7500) }]);
    const intersections = edgeIntersections({ a: { x: -200, y: 50 }, b: { x: 200, y: 50 } }, first.loops[0][0]);
    expect(intersections).toHaveLength(2);
    const xs = intersections.map((entry) => entry.point.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-Math.sqrt(7500), 12); expect(xs[1]).toBeCloseTo(Math.sqrt(7500), 12);
    const { intersection } = identity(first, second);
    expect(regionArea(intersection)).toBeCloseTo(20000 * Math.acos(.5) - 5000 * Math.sqrt(3), 9);
    expect(regionEdges(intersection).every((edge) => !!edge.circle)).toBe(true);
  });

  it("keeps coincident circles, rotated arc seams and complementary semicircles distinct", () => {
    const a = c(0, 0, 100), b = transformRegion(a, { x: 0, y: 0 }, 37);
    const { intersection, union, difference } = identity(a, b);
    expect(regionArea(intersection)).toBeCloseTo(Math.PI * 10000, 8);
    expect(regionArea(union)).toBeCloseTo(Math.PI * 10000, 8);
    expect(difference.loops).toHaveLength(0);
    expect(regionComponents(union)).toHaveLength(1);
  });

  it("separates external contact, disjoint disks, containment and tangent holes", () => {
    for (const x of [200, 240]) {
      const result = identity(c(0, 0, 100), c(x, 0, 100));
      expect(result.intersection.loops).toHaveLength(0);
      expect(regionComponents(result.union)).toHaveLength(2);
    }
    for (const x of [0, 50]) {
      const result = identity(c(0, 0, 100), c(x, 0, 50));
      expect(result.difference.loops.map((loop) => Math.sign(loopArea(loop))).sort()).toEqual([-1, 1]);
      expect(regionArea(result.difference)).toBeCloseTo(Math.PI * 7500, 8);
      expect(locatePoint({ x, y: 0 }, result.difference)).toBe(-1);
      expect(regionComponents(result.difference)).toHaveLength(1);
    }
  });

  it("keeps a small positive lens near tangency instead of using a pixel/area cutoff", () => {
    const a = c(0, 0, 100), b = c(200 - 1e-6, 0, 100), region = positiveRegion(booleanRegions(a, b, "intersection"));
    expect(regionArea(region)).toBeGreaterThan(0);
    expect(regionArea(region)).toBeLessThan(.0001);
    expect(regionEdges(region).every((edge) => !!edge.circle)).toBe(true);
    expect(booleanRegions(a, c(200 + 1e-6, 0, 100), "intersection")!.loops).toHaveLength(0);
  });

  it("retains both components when a circle meets a concave U", () => {
    const paper = polygon([[-150, -150], [-60, -150], [-60, 80], [60, 80], [60, -150], [150, -150], [150, 150], [-150, 150]]);
    const result = identity(paper, c(0, -80, 90));
    expect(regionComponents(result.intersection)).toHaveLength(2);
    expect(locatePoint({ x: 0, y: -80 }, result.intersection)).toBe(-1);
    expect(regionEdges(result.intersection).some((edge) => !!edge.circle)).toBe(true);
    expect(regionEdges(result.intersection).some((edge) => !edge.circle)).toBe(true);
  });

  it("computes four actual corner complements and four circular segments", () => {
    const disk = c(0, 0, 100), outer = positiveRegion(booleanRegions(square(100), disk, "difference"));
    const inner = positiveRegion(booleanRegions(disk, polygon([[100, 0], [0, 100], [-100, 0], [0, -100]]), "difference"));
    expect(regionComponents(outer)).toHaveLength(4);
    expect(regionComponents(inner)).toHaveLength(4);
    expect(regionArea(outer)).toBeCloseTo((4 - Math.PI) * 10000, 8);
    expect(regionArea(inner)).toBeCloseTo((Math.PI - 2) * 10000, 8);
    expect(regionComponents(inner).every((region) => regionEdges(region).some((edge) => edge.circle))).toBe(true);
    expect(locatePoint({ x: 0, y: 0 }, outer)).toBe(-1);
    expect(locatePoint({ x: 0, y: 0 }, inner)).toBe(-1);
  });

  it("cuts along arbitrary real chords, including a major circular segment", () => {
    const disk = c(0, 0, 100);
    const halves = cutRegion(disk, { x: -100, y: -100 }, { x: 100, y: 100 })!;
    for (const half of halves) expect(regionArea(positiveRegion(half))).toBeCloseTo(Math.PI * 5000, 8);
    const parts = cutRegion(disk, { x: -200, y: 50 }, { x: 200, y: 50 })!;
    expect(regionArea(parts[0])).toBeCloseTo(5000 * (2 * Math.PI / 3 - Math.sqrt(3) / 2), 8);
    expect(parts.every((part) => isValidCurveRegion(part))).toBe(true);
    expect(parts.reduce((area, region) => area + regionArea(region), 0)).toBeCloseTo(Math.PI * 10000, 8);
  });

  it("keeps rigidly transformed results usable as operands", () => {
    const lens = positiveRegion(booleanRegions(c(0, 0, 100), c(100, 0, 100), "intersection"));
    const posed = transformRegion(lens, { x: 1234, y: -987 }, 73, -1);
    expect(isValidCurveRegion(posed)).toBe(true);
    expect(regionArea(posed)).toBeCloseTo(regionArea(lens), 7);
    identity(posed, c(1250, -940, 85));
  });

  it("preserves area identities across deterministic unequal-circle and rotated-paper cases", () => {
    const paper = polygon([[-125, -90], [115, -90], [115, -15], [0, -15], [0, 100], [-125, 100]]);
    for (let index = 0; index < 18; index++) {
      identity(c(0, 0, 35 + index * 7), c(-130 + index * 15, 43 - index * 5, 140 - index * 4));
      identity(transformRegion(paper, { x: 1000, y: -500 }, index * 17), c(980 + index * 3, -540 + index * 4, 92));
    }
  });
});

describe("curved materials remain editable, independent and bounded", () => {
  it("supports free concave drawing, radius input and grip-preserving direct edits", () => {
    let state = createCurveGeometry(empty(), "polygon", [{ x: 0, y: 0 }, { x: 160, y: 0 }, { x: 160, y: 50 }, { x: 60, y: 50 }, { x: 60, y: 140 }, { x: 0, y: 140 }])!;
    state = { ...state, flags: { ...state.flags, edit: true } };
    const id = state.params.active, origin = curveMaterial(state)!.origin;
    const dragged = dragCurveMaterial(state, `curve.${id}`, { x: origin.x + 53, y: origin.y + 41 }, { x: 50, y: 40 });
    expect(curveMaterial(dragged)!.origin).toEqual({ x: origin.x + 50, y: origin.y + 40 });
    const vertex = curveMaterial(state)!.region.loops[0][0].a;
    expect(curveMaterial(dragCurveMaterial(state, `curve.${id}.vertex.0`, { x: 7, y: 8 }, { x: 5, y: 6 }))!.region.loops[0][0].a).toEqual({ x: vertex.x + 5, y: vertex.y + 6 });
    const circle = createCurveOverlapState(), r = curveMaterial(circle)!.region.loops[0][0].circle!.radius;
    const changed = dragCurveMaterial(circle, "curve.1.radius", { x: 600, y: 400 }, { x: 17.5, y: 28 });
    expect(curveMaterial(changed)!.region.loops[0][0].circle!.radius).toBe(r + 17.5);
    expect(setCurveField(circle, "radius", r + 17.5).points).toEqual(changed.points);
    expect(isValidCurveOverlapState(changed)).toBe(true);
  });

  it("extracts a leaf using the actual common chord and freezes independent source geometry", () => {
    let state = addCurveMaterial(empty(), "leaf");
    const ids = curveMaterials(state).map((material) => material.id); state = pair(state, ids[0], ids[1]);
    const expected = curveOverlapModel(state)!.intersectionArea, result = extractLeafSegments(state);
    expect(curveMaterials(result)).toHaveLength(4);
    const pieces = curveMaterials(result).filter((material) => material.kind === 2);
    expect(pieces).toHaveLength(2);
    expect(pieces.reduce((area, material) => area + regionArea(material.region), 0)).toBeCloseTo(expected, 8);
    expect(pieces.every((material) => regionEdges(material.region).some((edge) => !edge.circle))).toBe(true);
    expect(ids.every((id) => curveMaterial(result, id)!.reference)).toBe(true);
    const serialized = JSON.stringify(pieces);
    const sourceChanged = setCurveField(activateCurveMaterial(result, ids[0]), "radius", 160);
    expect(JSON.stringify(curveMaterials(sourceChanged).filter((material) => material.kind === 2))).toBe(serialized);
    expect(isValidCurveOverlapState(result)).toBe(true);
  });

  it("supports unequal-radius leaf segments and rejects same-circle or tangent fake chords", () => {
    let state = addCurveMaterial(empty(), "leaf"), ids = curveMaterials(state).map((material) => material.id);
    state = pair(setCurveField(activateCurveMaterial(state, ids[0]), "radius", 160), ids[0], ids[1]);
    const result = extractLeafSegments(state);
    expect(curveMaterials(result)).toHaveLength(4);
    expect(curveMaterials(result).filter((material) => material.kind === 2).reduce((sum, material) => sum + regionArea(material.region), 0)).toBeCloseTo(curveOverlapModel(state)!.intersectionArea, 7);
    state = createCurveOverlapState(); state = removeCurveMaterial(activateCurveMaterial(state, 0));
    state = duplicateCurveMaterial(state); ids = curveMaterials(state).map((material) => material.id);
    state = pair(state, ids[0], ids[1]);
    const first = curveMaterial(state, ids[0])!;
    state = setCurveField(setCurveField(state, "x", first.origin.x), "y", first.origin.y);
    expect(extractLeafSegments(state)).toBe(state);
    state = setCurveField(state, "x", first.origin.x + 240);
    expect(extractLeafSegments(state)).toBe(state);
  });

  it("creates real circle-square complements and moves each piece without leaving a solid underlay", () => {
    for (const inside of [false, true]) {
      const state = setCurveField(addSquareForCircle(createCurveOverlapState(), inside), "region", 3);
      const expected = curveOverlapModel(state)!.differenceArea, result = extractCurveRegion(state);
      const fragments = curveMaterials(result).filter((material) => material.kind === 2);
      expect(fragments).toHaveLength(4);
      expect(fragments.reduce((sum, material) => sum + regionArea(material.region), 0)).toBeCloseTo(expected, 7);
      expect(result.params.region).toBe(0);
      expect(curveMaterial(result, result.params.pairA)!.reference).toBe(true);
      const moved = moveCurveAside(result);
      expect(curveMaterial(moved)!.origin).not.toEqual(curveMaterial(result)!.origin);
      expect(curveMaterial(moved)!.region).toEqual(curveMaterial(result)!.region);
      expect(isValidCurveOverlapState(moved)).toBe(true);
    }
  });

  it("replaces a cut material by actual pieces, clears only affected pairing, and supports new booleans", () => {
    const initial = createCurveOverlapState(), circle = curveMaterial(initial)!;
    let result = splitCurveMaterial(initial, { x: 100, y: circle.origin.y }, { x: 800, y: circle.origin.y });
    expect(curveMaterial(result, 1)).toBeNull(); expect(result.params.pairA).toBe(0); expect(result.params.pairB).toBe(-1);
    const fragments = curveMaterials(result).filter((material) => material.kind === 2);
    expect(fragments).toHaveLength(2);
    expect(fragments.reduce((sum, material) => sum + regionArea(material.region), 0)).toBeCloseTo(Math.PI * 120 ** 2, 8);
    result = assignCurvePair(result, "pairB"); expect(curveOverlapModel(result)).not.toBeNull();
    expect(isValidCurveOverlapState(reflectCurveMaterial(rotateCurveMaterial(result, 57)))).toBe(true);
  });

  it("keeps every movement frame rigid and returns the piece home", () => {
    const initial = extractCurveRegion(setCurveField(createCurveOverlapState(), "region", 3)), start = setCurveField(initial, "angle", 170);
    const endpoint = rotateCurveMaterial(moveCurveAside(start), 90), original = curveMaterial(start)!;
    for (let index = 0; index <= 20; index++) {
      const frame = interpolateCurvePose(start, endpoint, index / 20), material = curveMaterial(frame)!;
      expect(isValidCurveOverlapState(frame)).toBe(true);
      expect(regionArea(curveWorldRegion(material))).toBeCloseTo(regionArea(original.region), 7);
      expect(material.region).toEqual(original.region);
    }
    const returned = returnCurveMaterial(endpoint);
    expect(curveMaterial(returned)!.origin).toEqual(original.home);
    expect(curveMaterial(returned)!.angle).toBe(0);
  });

  it("rejects a whole bundle at capacity and preserves existing pairs when adding other materials", () => {
    let state = createCurveOverlapState();
    while (curveMaterials(state).length < 15) state = addCurveMaterial(state, "circle");
    expect(state.params.pairA).toBe(0); expect(state.params.pairB).toBe(1);
    expect(addCurveMaterial(state, "leaf")).toBe(state);
    state = addCurveMaterial(state, "circle"); expect(curveMaterials(state)).toHaveLength(16);
    expect(duplicateCurveMaterial(state)).toBe(state);
    expect(addSquareForCircle(state, false)).toBe(state);
    expect(isValidCurveOverlapState(state)).toBe(true);
  });

  it("accepts 192 straight boundary points without reserving one numeric parameter per edge", () => {
    let state = empty();
    const points = Array.from({ length: 12 }, (_, i) => ({ x: 400 + 100 * Math.cos(i * Math.PI / 6), y: 300 + 100 * Math.sin(i * Math.PI / 6) }));
    for (let index = 0; index < 16; index++) state = createCurveGeometry(state, "polygon", points)!;
    expect(isValidCurveOverlapState(state)).toBe(true);
    expect(Object.keys(state.points).filter((key) => key.startsWith("vertex."))).toHaveLength(192);
    expect(Object.keys(state.params).length).toBeLessThan(256);
  });

  it("rejects malformed arcs, overlaps, crossings and wrong hole orientation", () => {
    expect(isValidCurveRegion(polygon([[0, 0], [100, 100], [0, 100], [100, 0]]))).toBe(false);
    const disk = c(0, 0, 100), hole = c(0, 0, 50);
    expect(isValidCurveRegion({ loops: [...disk.loops, ...hole.loops] })).toBe(false);
    expect(isValidCurveRegion({ loops: [...disk.loops, ...c(100, 0, 100).loops] })).toBe(false);
    const state = createCurveOverlapState(), malformed = structuredClone(state); malformed.points["vertex.1.0"].y = 20;
    expect(isValidCurveOverlapState(malformed)).toBe(false);
    const tooMany = writeCurveMaterials(state, [...curveMaterials(state), ...curveMaterials(state).map((material) => ({ ...material, id: material.id + 10 }))]);
    expect(isValidCurveOverlapState(tooMany)).toBe(false);
  });

  it("shares accepted and rejected persistence fixtures with SQL integration", () => {
    for (const fixture of planeOverlapCurvesCases()) {
      const scene = fixture.scene, envelope = scene.toolId === "plane-overlap" && scene.contentVersion === "plane-overlap-lesson-v4"
        && typeof scene.payload.title === "string" && scene.payload.title.trim().length >= 1 && scene.payload.title.trim().length <= 80;
      expect(envelope && isValidCurveOverlapState(scene.payload.initial), fixture.label).toBe(fixture.accepted);
    }
  });
});

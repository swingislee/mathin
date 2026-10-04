import { describe, expect, it } from "vitest";
import type { PlanarPoint as Point, PlanarState } from "@/features/tools/planar-kit/contract";
import { perpendicularFoot } from "@/features/tools/planar-kit/geometry";
import { add, cross, distance, dot, normalizeTurn, polar, POLYGON_LIMIT, polygonCornerGeometry, polygonJoinedCorners, polygonMaterial, polygonMaterials, polygonThreeRods, polygonWorldVertices, signedArea, subtract, toWorld, type PolygonKind } from "@/features/tools/plane-polygons/geometry";
import { activatePolygonMaterial, addPolygonMaterial, arrangePolygonCorners, copyPolygonFromRods, createPolygonGeometry, createPolygonWorkbenchState, dragPolygonMaterial, duplicatePolygonMaterial, emptyPolygonWorkbenchState, extractPolygonRods, interpolatePolygonCorners, interpolatePolygonFrame, nextPolygonBase, removePolygonMaterial, setPolygonField, shearPolygonFrame, togglePolygonCorners, togglePolygonHeight, unlockPolygonMaterial } from "@/features/tools/plane-polygons/model";
import { isValidPolygonWorkbenchState } from "@/features/tools/plane-polygons/validation";
import { planePolygonWorkbenchCases } from "./fixtures/plane-polygons-open-cases";

const one = (kind: PolygonKind) => addPolygonMaterial(emptyPolygonWorkbenchState(), kind);
const closePoint = (actual: Point, expected: Point, digits = 8) => { expect(actual.x).toBeCloseTo(expected.x, digits); expect(actual.y).toBeCloseTo(expected.y, digits); };
const edges = (state: PlanarState) => { const v = polygonWorldVertices(polygonMaterial(state)!); return v.map((p, i) => subtract(v[(i + 1) % v.length], p)); };

describe("open polygon and rod materials", () => {
  it("starts with usable independent materials and keeps every observation off", () => {
    const state = createPolygonWorkbenchState(); expect(isValidPolygonWorkbenchState(state)).toBe(true);
    expect(polygonMaterials(state).map((o) => o.kind)).toEqual([3, 2]);
    expect(Object.values(state.flags).every((flag) => flag === false)).toBe(true);
    expect(polygonMaterial(state, 0)?.origin).not.toEqual(polygonMaterial(state, 1)?.origin);
    let added = state;
    for (let kind = 0; kind <= 9; kind++) {
      const before = structuredClone(added); added = addPolygonMaterial(added, kind as PolygonKind);
      expect(isValidPolygonWorkbenchState(added)).toBe(true);
      polygonMaterials(before).forEach((o) => expect(polygonMaterial(added, o.id)).toEqual(o));
    }
    expect(added.params.count).toBe(12); expect(state.params.count).toBe(2);
  });
  it("draws arbitrary triangles and simple concave quadrilaterals without replacing the stage", () => {
    const triangle = [{ x: 180, y: 310 }, { x: 480, y: 365 }, { x: 245, y: 140 }];
    const quad = [{ x: 530, y: 420 }, { x: 790, y: 380 }, { x: 615, y: 340 }, { x: 550, y: 150 }];
    let state = createPolygonGeometry(one(0), "triangle", triangle)!;
    state = createPolygonGeometry(state, "quadrilateral", quad)!;
    expect(state.params.count).toBe(3); expect(isValidPolygonWorkbenchState(state)).toBe(true);
    polygonWorldVertices(polygonMaterial(state, 1)!).forEach((p, i) => closePoint(p, triangle[i]));
    polygonWorldVertices(polygonMaterial(state, 2)!).forEach((p, i) => closePoint(p, quad[i]));
    expect(createPolygonGeometry(state, "triangle", triangle.slice(0, 2))).toBeNull();
    expect(createPolygonGeometry(state, "quadrilateral", [{ x: 0, y: 0 }, { x: 240, y: 140 }, { x: 210, y: 0 }, { x: 0, y: 180 }])).toBeNull();
  });
  it("preserves both sides and arbitrary directions when drawing rods and hinged frames", () => {
    const a = { x: 230, y: 270 }, b = { x: 410, y: 365 };
    for (const c of [{ x: 175, y: 405 }, { x: 370, y: 135 }]) {
      for (const tool of ["rods", "frame"]) {
        const state = createPolygonGeometry(emptyPolygonWorkbenchState(), tool, [a, b, c])!;
        expect(isValidPolygonWorkbenchState(state)).toBe(true);
        const v = polygonWorldVertices(polygonMaterial(state)!);
        closePoint(v[0], a); closePoint(v[1], b); closePoint(v[tool === "rods" ? 2 : 3], c);
      }
    }
    const state = createPolygonGeometry(emptyPolygonWorkbenchState(), "rod", [a, b])!;
    closePoint(polygonWorldVertices(polygonMaterial(state)!)[1], b);
  });
  it("keeps the three actual rod lengths for feasible, flat and all three infeasible cases", () => {
    for (const [width, left, right] of [[200, 150, 170], [280, 120, 160], [400, 120, 160], [120, 400, 160], [120, 160, 400], [319.999999, 150, 170]]) {
      const rods = polygonThreeRods(width, left, right);
      rods.segments.forEach(([a, b], index) => expect(distance(a, b)).toBeCloseTo([width, left, right][index], 7));
      const largest = Math.max(width, left, right), gap = Math.max(0, 2 * largest - width - left - right);
      expect(rods.gap).toBeCloseTo(gap, 8); expect(rods.closed).toBe(largest < width + left + right - largest);
      if (rods.closed) expect(rods.points[2]).toEqual(rods.points[3]);
    }
  });
  it("lets a closed three-rod joint move to either side while preserving the actual picked point", () => {
    const state = setPolygonField(one(1), "rotation", 37), object = polygonMaterial(state)!;
    for (const local of [{ x: 75, y: -140 }, { x: 125, y: 155 }]) {
      const point = toWorld(object, local), next = dragPolygonMaterial(state, "polygon.0.vertex.2", point, subtract(point, polygonWorldVertices(object)[2]));
      expect(isValidPolygonWorkbenchState(next)).toBe(true); closePoint(polygonWorldVertices(polygonMaterial(next)!)[2], point);
      closePoint(polygonWorldVertices(polygonMaterial(next)!)[0], object.origin);
    }
  });
  it("copies the actual three rods and a feasible triangle atomically, preserving the source", () => {
    const state = setPolygonField(one(1), "rotation", -83), original = polygonMaterial(state)!;
    const next = extractPolygonRods(state); expect(next.params.count).toBe(4); expect(polygonMaterial(next, 0)).toEqual(original);
    const expected = polygonThreeRods(original.dimensions.width!, original.dimensions.left!, original.dimensions.right!).segments;
    expected.forEach(([a, b], i) => polygonWorldVertices(polygonMaterial(next, i + 1)!).forEach((p, j) => closePoint(p, toWorld(original, [a, b][j]))));
    const triangle = copyPolygonFromRods(state); expect(triangle.params.count).toBe(2); expect(polygonMaterial(triangle)?.kind).toBe(3);
    expect(copyPolygonFromRods(setPolygonField(state, "width", 15)).params.count).toBe(1);
    let full = state; for (let i = 1; i < 14; i++) full = addPolygonMaterial(full, 0);
    full = activatePolygonMaterial(full, "polygon.0.body"); expect(extractPolygonRods(full)).toBe(full);
  });
  it("keeps all four rod lengths throughout a rotated joint drag and the entire shear animation", () => {
    const state = setPolygonField(one(2), "rotation", 127), object = polygonMaterial(state)!;
    const initialLengths = edges(state).map((edge) => Math.hypot(edge.x, edge.y));
    const point = toWorld(object, polar(object.dimensions.left!, -115));
    const dragged = dragPolygonMaterial(state, "polygon.0.vertex.3", point, subtract(point, polygonWorldVertices(object)[3]));
    expect(polygonMaterial(dragged)?.dimensions.opening).toBeCloseTo(115, 8);
    const endpoint = shearPolygonFrame(state);
    for (const candidate of [dragged, ...[0, .1, .25, .5, .9, 1].map((progress) => interpolatePolygonFrame(state, endpoint, progress))]) {
      expect(isValidPolygonWorkbenchState(candidate)).toBe(true);
      edges(candidate).forEach((edge, i) => expect(Math.hypot(edge.x, edge.y)).toBeCloseTo(initialLengths[i], 8));
    }
  });
  it("keeps each family's defining constraints after accurate dimensions and direct point editing", () => {
    for (const kind of [5, 6, 7, 8, 9] as const) {
      let state = setPolygonField(setPolygonField(one(kind), "width", 6.25), "rotation", -52.5);
      if ([5, 7, 9].includes(kind)) state = setPolygonField(state, "height", 3.75);
      if (kind === 9) state = setPolygonField(state, "top", 4.1);
      const object = polygonMaterial(state)!;
      const point = toWorld(object, { x: 70, y: -170 });
      state = dragPolygonMaterial(state, "polygon.0.vertex.3", point, subtract(point, polygonWorldVertices(object)[3]));
      expect(isValidPolygonWorkbenchState(state)).toBe(true); expect(polygonMaterial(state)?.kind).toBe(kind);
      const e = edges(state), lengths = e.map((v) => Math.hypot(v.x, v.y));
      expect(cross(e[0], e[2])).toBeCloseTo(0, 7);
      if (kind !== 9) expect(cross(e[1], e[3])).toBeCloseTo(0, 7);
      if (kind === 5 || kind === 6) expect(dot(e[0], e[1])).toBeCloseTo(0, 7);
      if (kind === 6 || kind === 8) lengths.forEach((length) => expect(length).toBeCloseTo(lengths[0], 8));
      if (kind === 9) expect(lengths[2]).toBeCloseTo(164, 8);
    }
  });
  it("explicitly releases family constraints before a free vertex edit", () => {
    const original = setPolygonField(one(5), "rotation", 38), world = polygonWorldVertices(polygonMaterial(original)!);
    const free = unlockPolygonMaterial(original); expect(polygonMaterial(free)?.kind).toBe(4);
    polygonWorldVertices(polygonMaterial(free)!).forEach((p, i) => closePoint(p, world[i]));
    const target = add(world[2], { x: -55, y: 38 }), changed = dragPolygonMaterial(free, "polygon.0.vertex.2", target, { x: -55, y: 38 });
    expect(changed).not.toBe(free); expect(isValidPolygonWorkbenchState(changed)).toBe(true);
    closePoint(polygonWorldVertices(polygonMaterial(changed)!)[2], target);
    expect(Object.keys(changed.params)).not.toContain("height.0"); expect(Object.keys(changed.params)).not.toContain("width.0");
    for (const opening of [5, 15, 30, 45, 65, 120, 175]) {
      const smallest = setPolygonField(setPolygonField(one(8), "width", .1), "opening", opening), unlocked = unlockPolygonMaterial(smallest);
      expect(polygonMaterial(unlocked)?.kind).toBe(4); expect(isValidPolygonWorkbenchState(unlocked)).toBe(true);
    }
  });
  it("shares direct and accurate free-vertex endpoints, scopes selection and refuses self-intersection", () => {
    let state = addPolygonMaterial(one(3), 5); const target = { x: 345, y: 295 };
    const direct = dragPolygonMaterial(state, "polygon.0.vertex.1", target, { x: -25, y: -55 });
    state = activatePolygonMaterial(state, "polygon.0.vertex.1");
    const exact = setPolygonField(setPolygonField(state, "pointX", target.x / 40), "pointY", target.y / 40);
    expect(exact.points).toEqual(direct.points); expect(polygonMaterial(direct, 1)).toEqual(polygonMaterial(state, 1));
    expect(direct.params.active).toBe(0);
    const quad = one(4), points = polygonWorldVertices(polygonMaterial(quad)!);
    const rejected = dragPolygonMaterial(quad, "polygon.0.vertex.1", points[3], subtract(points[3], points[1]));
    expect(rejected).toBe(quad); expect(setPolygonField(quad, "pointX", Infinity)).toBe(quad);
    const triangle = one(3), vertex = polygonWorldVertices(polygonMaterial(triangle)!)[2], shift = { x: 35, y: -25 };
    const offsetGrip = dragPolygonMaterial(triangle, "polygon.0.vertex.2", add(vertex, { x: 43, y: -18 }), shift);
    closePoint(polygonWorldVertices(polygonMaterial(offsetGrip)!)[2], add(vertex, shift));
  });
  it("selects arbitrary bases while keeping each true altitude perpendicular, including concave exterior feet", () => {
    let state = createPolygonGeometry(emptyPolygonWorkbenchState(), "quadrilateral", [{ x: 100, y: 400 }, { x: 400, y: 380 }, { x: 185, y: 340 }, { x: 170, y: 110 }])!;
    state = togglePolygonHeight(setPolygonField(state, "rotation", 41));
    for (let i = 0; i < 4; i++) {
      const object = polygonMaterial(state)!, vertices = polygonWorldVertices(object), a = vertices[object.base], b = vertices[(object.base + 1) % 4];
      vertices.filter((_, j) => j !== object.base && j !== (object.base + 1) % 4).forEach((vertex) => {
        const foot = perpendicularFoot(vertex, a, b)!; expect(dot(subtract(vertex, foot), subtract(b, a))).toBeCloseTo(0, 7);
      });
      state = nextPolygonBase(state); expect(polygonMaterial(state)?.height).toBe(true);
    }
    expect(polygonMaterial(state)?.base).toBe(0);
    const picked = activatePolygonMaterial(state, "polygon.0.edge.2"); expect(polygonMaterial(picked)?.base).toBe(2);
    const moved = dragPolygonMaterial(picked, "polygon.0.edge.1", { x: 0, y: 0 }, { x: 25, y: -18 });
    expect(polygonMaterial(moved)?.base).toBe(2);
  });
  it("splits the actual angles of acute, obtuse, right and reversed triangles and joins a straight angle", () => {
    const triangles = [
      [{ x: 100, y: 300 }, { x: 360, y: 300 }, { x: 220, y: 100 }],
      [{ x: 100, y: 300 }, { x: 360, y: 300 }, { x: 145, y: 250 }],
      [{ x: 100, y: 300 }, { x: 360, y: 300 }, { x: 100, y: 100 }],
    ];
    for (const source of triangles) for (const points of [source, [...source].reverse()]) {
      let state = createPolygonGeometry(emptyPolygonWorkbenchState(), "triangle", points)!;
      state = setPolygonField(state, "rotation", 29.75);
      const before = structuredClone(state), split = togglePolygonCorners(state), object = polygonMaterial(split)!;
      const geometry = polygonCornerGeometry(object), joined = arrangePolygonCorners(split, true), poses = polygonMaterial(joined)!.corners!;
      expect(geometry.reduce((sum, corner) => sum + Math.abs(corner.sweep), 0)).toBeCloseTo(180, 9);
      expect(poses.every((pose) => distance(pose.at, poses[0].at) === 0)).toBe(true);
      geometry.slice(0, 2).forEach((corner, i) => expect(normalizeTurn(poses[i].turn + corner.sweep - poses[i + 1].turn)).toBeCloseTo(0, 8));
      expect(Math.abs(normalizeTurn(poses[2].turn + geometry[2].sweep - poses[0].turn))).toBeCloseTo(180, 8);
      expect(state).toEqual(before); expect(polygonMaterial(joined)!.vertices).toEqual(polygonMaterial(before)!.vertices);
      expect(togglePolygonCorners(joined)).toEqual(before);
    }
  });
  it("preserves all angle-piece dimensions and original geometry at every rigid animation stop", () => {
    const from = togglePolygonCorners(one(3)), to = arrangePolygonCorners(from, true), original = polygonMaterial(from)!;
    const geometry = polygonCornerGeometry(original), area = Math.abs(signedArea(original.vertices));
    for (const progress of [0, .07, .25, .333, .5, .66, .85, 1]) {
      const frame = interpolatePolygonCorners(from, to, progress), object = polygonMaterial(frame)!;
      expect(isValidPolygonWorkbenchState(frame)).toBe(true);
      expect(polygonCornerGeometry(object)).toEqual(geometry); expect(Math.abs(signedArea(object.vertices))).toBe(area);
      object.corners!.forEach((corner, i) => {
        const a = add(corner.at, polar(geometry[i].radius, corner.turn)), b = add(corner.at, polar(geometry[i].radius, corner.turn + geometry[i].sweep));
        expect(distance(corner.at, a)).toBeCloseTo(geometry[i].radius, 8);
        expect(distance(a, b)).toBeCloseTo(2 * geometry[i].radius * Math.sin(Math.abs(geometry[i].sweep) * Math.PI / 360), 8);
      });
      expect(isValidPolygonWorkbenchState(JSON.parse(JSON.stringify(frame)))).toBe(true);
    }
  });
  it("moves independent corner pieces with the original grip offset and shares exact pose fields", () => {
    let state = togglePolygonCorners(setPolygonField(one(3), "rotation", -47));
    const object = polygonMaterial(state)!, originalPoint = toWorld(object, object.corners![1].at), delta = { x: 42, y: -35 };
    const dragged = dragPolygonMaterial(state, "polygon.0.corner.1", add(originalPoint, { x: 51, y: -24 }), delta);
    closePoint(toWorld(polygonMaterial(dragged)!, polygonMaterial(dragged)!.corners![1].at), add(originalPoint, delta));
    state = activatePolygonMaterial(state, "polygon.0.corner.1");
    const exact = setPolygonField(setPolygonField(state, "cornerX", (originalPoint.x + delta.x) / 40), "cornerY", (originalPoint.y + delta.y) / 40);
    closePoint(polygonMaterial(exact)!.corners![1].at, polygonMaterial(dragged)!.corners![1].at);
    expect(polygonMaterial(dragged)!.corners![0]).toEqual(object.corners![0]);
    const turned = setPolygonField(exact, "cornerTurn", 179.5);
    expect(normalizeTurn(polygonMaterial(turned)!.corners![1].turn + object.rotation)).toBeCloseTo(179.5);
  });
  it("duplicates and removes full materials including independent observations and corner poses", () => {
    const state = togglePolygonHeight(arrangePolygonCorners(togglePolygonCorners(one(3)), true));
    let next = duplicatePolygonMaterial(state); expect(next.params.count).toBe(2);
    expect(polygonMaterial(next)?.corners).toEqual(polygonMaterial(state)?.corners); expect(polygonMaterial(next)?.height).toBe(true);
    next = removePolygonMaterial(activatePolygonMaterial(next, "polygon.0.body"));
    expect(next.params.count).toBe(1); expect(isValidPolygonWorkbenchState(next)).toBe(true);
    expect(polygonJoinedCorners(polygonMaterial(next)!)).toEqual(polygonMaterial(next)!.corners);
    next = removePolygonMaterial(next); expect(next).toEqual(emptyPolygonWorkbenchState());
    for (let i = 0; i < POLYGON_LIMIT; i++) next = addPolygonMaterial(next, 0);
    expect(duplicatePolygonMaterial(next)).toBe(next); expect(addPolygonMaterial(next, 3)).toBe(next);
  });
  it("applies the shared strict persistence fixture matrix", () => {
    for (const fixture of planePolygonWorkbenchCases()) {
      const title = fixture.scene.payload.title.trim();
      const actual = fixture.scene.contentVersion === "plane-polygons-lesson-v2" && title.length > 0 && title.length <= 80 && isValidPolygonWorkbenchState(fixture.scene.payload.initial);
      expect(actual, fixture.label).toBe(fixture.accepted);
    }
  });
});

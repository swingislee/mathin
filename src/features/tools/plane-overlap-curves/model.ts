import type { PlanarState } from "../planar-kit/contract";
import { booleanRegions, cutRegion, regionComponents } from "./boolean";
import { add, circleRegion, distance, mul, normalizeAngle, polygonRegion, regionArea, regionBounds, regionEdges, sub, transformRegion, type CurveRegion, type Point } from "./geometry";
import { circleIntersections } from "./intersections";
import { CURVE_BOUND, CURVE_FLAGS, CURVE_LIMIT, CURVE_RADIUS_MAX, CURVE_RADIUS_MIN, CURVE_SCENE, curveMaterial, curveMaterials, writeCurveMaterials, type CurveMaterial } from "./state";
import { isValidCurveOverlapState, isValidCurveRegion } from "./validation";

export { curveMaterial, curveMaterials } from "./state";
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const centerOf = (region: CurveRegion) => { const bounds = regionBounds(region); return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }; };
export const curveWorldRegion = (material: CurveMaterial) => transformRegion(material.region, material.origin, material.angle, material.flip);

function materialFromRegion(id: number, region: CurveRegion, kind: CurveMaterial["kind"] = 2): CurveMaterial {
  const origin = kind === 1 ? region.loops[0][0].circle!.center : centerOf(region);
  return { id, kind, origin: { ...origin }, home: { ...origin }, angle: 0, flip: 1, reference: false,
    region: kind === 1 ? circleRegion({ x: 0, y: 0 }, region.loops[0][0].circle!.radius) : transformRegion(region, mul(origin, -1)) };
}

export function settleCurveState(before: PlanarState, next: PlanarState): PlanarState {
  return before !== next && isValidCurveOverlapState(next) ? next : before;
}

function replaceMaterial(state: PlanarState, material: CurveMaterial): PlanarState {
  return settleCurveState(state, writeCurveMaterials(state, curveMaterials(state).map((entry) => entry.id === material.id ? material : entry)));
}

function appendRegions(state: PlanarState, additions: readonly { region: CurveRegion; kind?: CurveMaterial["kind"] }[], sourcesAsReferences: number[] = []): PlanarState {
  const materials = curveMaterials(state), first = state.params.nextId;
  if (!additions.length || materials.length + additions.length > CURVE_LIMIT || first + additions.length > 99999
    || additions.some((entry) => !isValidCurveRegion(entry.region))) return state;
  const next = { ...state, params: { ...state.params, nextId: first + additions.length, active: first, vertex: 0, ...(sourcesAsReferences.length ? { region: 0 } : {}) } };
  return settleCurveState(state, writeCurveMaterials(next, [
    ...materials.map((material) => sourcesAsReferences.includes(material.id) ? { ...material, reference: true } : material),
    ...additions.map((entry, index) => materialFromRegion(first + index, entry.region, entry.kind)),
  ]));
}

export function createCurveOverlapState(): PlanarState {
  const initial: PlanarState = { sceneId: CURVE_SCENE, phase: 0, marks: [], points: {},
    params: { nextId: 2, active: 1, pairA: 0, pairB: 1, region: 0, vertex: 0 },
    flags: Object.fromEntries(CURVE_FLAGS.map((key) => [key, false])) };
  return writeCurveMaterials(initial, [
    materialFromRegion(0, polygonRegion([{ x: 250, y: 200 }, { x: 490, y: 200 }, { x: 490, y: 440 }, { x: 250, y: 440 }]), 0),
    materialFromRegion(1, circleRegion({ x: 465, y: 345 }, 120), 1),
  ]);
}

export function activateCurveMaterial(state: PlanarState, id: number, vertex?: number): PlanarState {
  const material = curveMaterial(state, id); if (!material) return state;
  return { ...state, params: { ...state.params, active: id, vertex: clamp(vertex ?? 0, 0, regionEdges(material.region).length - 1) } };
}

export function addCurveMaterial(state: PlanarState, preset: string): PlanarState {
  const n = curveMaterials(state).length, at = { x: 380 + n % 4 * 36, y: 300 + n % 3 * 28 }, radius = 105;
  const shifted = (points: Point[]) => polygonRegion(points.map((point) => add(at, point)));
  if (preset === "circle") return appendRegions(state, [{ region: circleRegion(at, radius), kind: 1 }]);
  if (preset === "leaf") return appendRegions(state, [{ region: circleRegion(at, radius), kind: 1 }, { region: circleRegion(add(at, { x: radius, y: radius }), radius), kind: 1 }]);
  if (preset === "outer" || preset === "inner") {
    const vertices = preset === "outer" ? [{ x: -radius, y: -radius }, { x: radius, y: -radius }, { x: radius, y: radius }, { x: -radius, y: radius }]
      : [{ x: radius, y: 0 }, { x: 0, y: radius }, { x: -radius, y: 0 }, { x: 0, y: -radius }];
    return appendRegions(state, [{ region: circleRegion(at, radius), kind: 1 }, { region: shifted(vertices), kind: 0 }]);
  }
  const points = preset === "triangle" ? [{ x: -110, y: 90 }, { x: 125, y: 90 }, { x: -25, y: -110 }]
    : preset === "concave" ? [{ x: -130, y: -110 }, { x: 125, y: -110 }, { x: 125, y: -15 }, { x: -15, y: -15 }, { x: -15, y: 120 }, { x: -130, y: 120 }]
      : preset === "square" ? [{ x: -105, y: -105 }, { x: 105, y: -105 }, { x: 105, y: 105 }, { x: -105, y: 105 }] : null;
  return points ? appendRegions(state, [{ region: shifted(points), kind: 0 }]) : state;
}

export function createCurveGeometry(state: PlanarState, tool: string, points: readonly Point[]): PlanarState | null {
  if (!points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  if (tool === "cut") {
    if (points.length !== 2) return null;
    const next = splitCurveMaterial(state, points[0], points[1]); return next === state ? null : next;
  }
  let region: CurveRegion, kind: CurveMaterial["kind"];
  if (tool === "circle" && points.length === 2) { region = circleRegion(points[0], distance(points[0], points[1])); kind = 1; }
  else if (tool === "rectangle" && points.length === 2) {
    const [a, b] = points; region = polygonRegion([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }]); kind = 0;
  } else if (tool === "polygon" && points.length >= 3 && points.length <= 32) { region = polygonRegion(points); kind = 0; }
  else return null;
  const next = appendRegions(state, [{ region, kind }]); return next === state ? null : next;
}

export function assignCurvePair(state: PlanarState, slot: "pairA" | "pairB"): PlanarState {
  const active = state.params.active;
  if (!curveMaterial(state) || active === state.params[slot === "pairA" ? "pairB" : "pairA"]) return state;
  return { ...state, params: { ...state.params, [slot]: active } };
}

function computeOverlap(state: PlanarState) {
  const first = curveMaterial(state, state.params.pairA), second = curveMaterial(state, state.params.pairB);
  if (!first || !second || first.id === second.id) return null;
  const a = curveWorldRegion(first), b = curveWorldRegion(second), intersection = booleanRegions(a, b, "intersection"), union = booleanRegions(a, b, "union"), difference = booleanRegions(a, b, "difference"), reverseDifference = booleanRegions(b, a, "difference");
  if (![intersection, union, difference, reverseDifference].every((region) => region && isValidCurveRegion(region, true))) return null;
  return { a, b, regions: [{ loops: [] }, intersection!, union!, difference!, reverseDifference!],
    areaA: regionArea(a), areaB: regionArea(b), intersectionArea: regionArea(intersection!), unionArea: regionArea(union!), differenceArea: regionArea(difference!), reverseDifferenceArea: regionArea(reverseDifference!) };
}
const cache = new WeakMap<PlanarState, ReturnType<typeof computeOverlap>>();
export function curveOverlapModel(state: PlanarState) {
  if (!cache.has(state)) cache.set(state, computeOverlap(state));
  return cache.get(state)!;
}

export function extractCurveRegion(state: PlanarState): PlanarState {
  const model = curveOverlapModel(state), region = model?.regions[state.params.region];
  if (!region?.loops.length) return state;
  return appendRegions(state, regionComponents(region).map((component) => ({ region: component })), [state.params.pairA, state.params.pairB]);
}

export function extractLeafSegments(state: PlanarState): PlanarState {
  const first = curveMaterial(state, state.params.pairA), second = curveMaterial(state, state.params.pairB), model = curveOverlapModel(state);
  if (!first || !second || first.kind !== 1 || second.kind !== 1 || !model) return state;
  const chord = circleIntersections(model.a.loops[0][0].circle!, model.b.loops[0][0].circle!);
  if (chord.length !== 2) return state;
  const split = cutRegion(model.regions[1], chord[0], chord[1]);
  if (!split || split.some((region) => !region.loops.length)) return state;
  return appendRegions(state, split.flatMap((region) => regionComponents(region).map((component) => ({ region: component }))), [first.id, second.id]);
}

export function splitCurveMaterial(state: PlanarState, a: Point, b: Point): PlanarState {
  const material = curveMaterial(state); if (!material) return state;
  const pieces = cutRegion(curveWorldRegion(material), a, b);
  if (!pieces || pieces.some((region) => !region.loops.length)) return state;
  const components = pieces.flatMap(regionComponents), first = state.params.nextId;
  if (curveMaterials(state).length - 1 + components.length > CURVE_LIMIT || first + components.length > 99999) return state;
  const next = { ...state, params: { ...state.params, nextId: first + components.length, active: first, vertex: 0,
    pairA: state.params.pairA === material.id ? -1 : state.params.pairA, pairB: state.params.pairB === material.id ? -1 : state.params.pairB } };
  return settleCurveState(state, writeCurveMaterials(next, [...curveMaterials(state).filter((entry) => entry.id !== material.id), ...components.map((region, i) => materialFromRegion(first + i, region))]));
}

export function splitCurveComponents(state: PlanarState): PlanarState {
  const material = curveMaterial(state); if (!material) return state;
  const components = regionComponents(curveWorldRegion(material)); if (components.length < 2) return state;
  const first = state.params.nextId, remaining = curveMaterials(state).filter((entry) => entry.id !== material.id);
  if (remaining.length + components.length > CURVE_LIMIT || first + components.length > 99999) return state;
  const next = { ...state, params: { ...state.params, nextId: first + components.length, active: first, vertex: 0,
    pairA: state.params.pairA === material.id ? -1 : state.params.pairA, pairB: state.params.pairB === material.id ? -1 : state.params.pairB } };
  return settleCurveState(state, writeCurveMaterials(next, [...remaining, ...components.map((region, i) => materialFromRegion(first + i, region))]));
}

export function duplicateCurveMaterial(state: PlanarState): PlanarState {
  const material = curveMaterial(state); if (!material) return state;
  return appendRegions(state, [{ region: transformRegion(curveWorldRegion(material), { x: 28, y: 28 }), kind: material.kind }]);
}
export function removeCurveMaterial(state: PlanarState): PlanarState {
  const material = curveMaterial(state); if (!material) return state;
  const materials = curveMaterials(state).filter((entry) => entry.id !== material.id);
  const next = { ...state, params: { ...state.params, active: materials.at(-1)?.id ?? -1, vertex: 0,
    pairA: state.params.pairA === material.id ? -1 : state.params.pairA, pairB: state.params.pairB === material.id ? -1 : state.params.pairB } };
  return writeCurveMaterials(next, materials);
}

export function setCurveField(state: PlanarState, key: string, value: number): PlanarState {
  if (!Number.isFinite(value)) return state;
  if (key === "region") return { ...state, params: { ...state.params, region: clamp(Math.round(value), 0, 4) } };
  const material = curveMaterial(state); if (!material) return state;
  if (key === "vertex") return { ...state, params: { ...state.params, vertex: clamp(Math.round(value), 0, regionEdges(material.region).length - 1) } };
  if (key === "x" || key === "y") return replaceMaterial(state, { ...material, origin: { ...material.origin, [key]: clamp(value, -CURVE_BOUND, CURVE_BOUND) } });
  if (key === "angle") return replaceMaterial(state, { ...material, angle: normalizeAngle(value) });
  if (key === "radius" && material.kind === 1) return replaceMaterial(state, { ...material, region: circleRegion({ x: 0, y: 0 }, clamp(value, CURVE_RADIUS_MIN, CURVE_RADIUS_MAX)) });
  if (material.kind === 0) {
    const vertices = material.region.loops[0].map((edge) => ({ ...edge.a })), bounds = regionBounds(material.region);
    if (key === "width" || key === "height") {
      const scale = value / bounds[key]; if (!Number.isFinite(scale) || scale <= 0) return state;
      vertices.forEach((point) => { if (key === "width") point.x *= scale; else point.y *= scale; });
    } else if (key === "vertexX" || key === "vertexY") {
      const point = vertices[state.params.vertex]; if (!point) return state;
      point[key === "vertexX" ? "x" : "y"] = value;
    } else return state;
    const region = { loops: [vertices.map((a, i) => ({ a, b: vertices[(i + 1) % vertices.length] }))] };
    return replaceMaterial(state, { ...material, region });
  }
  return state;
}

export function toggleCurveReference(state: PlanarState): PlanarState {
  const material = curveMaterial(state); return material ? replaceMaterial(state, { ...material, reference: !material.reference }) : state;
}
export function rotateCurveMaterial(state: PlanarState, angle = 90): PlanarState {
  const material = curveMaterial(state); return material ? setCurveField(state, "angle", material.angle + angle) : state;
}
export function reflectCurveMaterial(state: PlanarState): PlanarState {
  const material = curveMaterial(state); return material ? replaceMaterial(state, { ...material, flip: -material.flip as 1 | -1 }) : state;
}
export function returnCurveMaterial(state: PlanarState): PlanarState {
  const material = curveMaterial(state); return material ? replaceMaterial(state, { ...material, origin: { ...material.home }, angle: 0 }) : state;
}
export function moveCurveAside(state: PlanarState): PlanarState {
  const material = curveMaterial(state); if (!material) return state;
  return replaceMaterial(state, { ...material, origin: add(material.origin, { x: 135, y: 55 }) });
}

export function curveTarget(target: string): { id: number; part: "body" | "rotate" | "radius" | "vertex"; vertex?: number } | null {
  const match = /^curve\.(0|[1-9]\d{0,4})(?:\.(rotate|radius|vertex)(?:\.(0|[1-9]\d{0,2}))?)?$/.exec(target);
  if (!match || match[2] === "vertex" && match[3] === undefined || match[2] !== "vertex" && match[3] !== undefined) return null;
  return { id: Number(match[1]), part: (match[2] ?? "body") as "body" | "rotate" | "radius" | "vertex", ...(match[3] === undefined ? {} : { vertex: Number(match[3]) }) };
}

export function dragCurveMaterial(start: PlanarState, target: string, point: Point, delta: Point): PlanarState {
  const parsed = curveTarget(target), material = parsed && curveMaterial(start, parsed.id); if (!parsed || !material) return start;
  const selected = activateCurveMaterial(start, parsed.id, parsed.vertex);
  const radians = material.angle * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
  const localDelta = { x: (c * delta.x + s * delta.y) * material.flip, y: -s * delta.x + c * delta.y };
  if (parsed.part === "body") return replaceMaterial(selected, { ...material, origin: add(material.origin, delta) });
  if (parsed.part === "rotate") {
    const initial = sub(sub(point, delta), material.origin), current = sub(point, material.origin);
    if (!Math.hypot(initial.x, initial.y) || !Math.hypot(current.x, current.y)) return selected;
    return setCurveField(selected, "angle", material.angle + (Math.atan2(current.y, current.x) - Math.atan2(initial.y, initial.x)) * 180 / Math.PI);
  }
  if (parsed.part === "radius" && material.kind === 1) return setCurveField(selected, "radius", material.region.loops[0][0].circle!.radius + localDelta.x);
  if (parsed.part === "vertex" && material.kind === 0 && start.flags.edit) {
    const vertices = material.region.loops[0].map((edge) => ({ ...edge.a }));
    if (parsed.vertex === undefined || !vertices[parsed.vertex]) return selected;
    vertices[parsed.vertex] = add(vertices[parsed.vertex], localDelta);
    return replaceMaterial(selected, { ...material, region: { loops: [vertices.map((a, i) => ({ a, b: vertices[(i + 1) % vertices.length] }))] } });
  }
  return selected;
}

/** 动画只移动刚性位姿；准确暂停帧使用相同边界，圆弧半径与面积保持。 */
export function interpolateCurvePose(from: PlanarState, to: PlanarState, progress: number): PlanarState {
  if (progress <= 0) return from; if (progress >= 1) return to;
  return writeCurveMaterials(to, curveMaterials(to).map((material) => {
    const before = curveMaterial(from, material.id); if (!before) return material;
    return { ...material, origin: add(before.origin, mul(sub(material.origin, before.origin), progress)),
      angle: normalizeAngle(before.angle + normalizeAngle(material.angle - before.angle) * progress), flip: before.flip };
  }));
}

/** 给当前真圆添加准确内接/外切方，只有这个明确动作会同时指定本次 A/B。 */
export function addSquareForCircle(state: PlanarState, inside: boolean): PlanarState {
  const material = curveMaterial(state); if (material?.kind !== 1) return state;
  const circle = curveWorldRegion(material).loops[0][0].circle!, r = circle.radius;
  const points = inside ? [{ x: r, y: 0 }, { x: 0, y: r }, { x: -r, y: 0 }, { x: 0, y: -r }]
    : [{ x: -r, y: -r }, { x: r, y: -r }, { x: r, y: r }, { x: -r, y: r }];
  const next = appendRegions(state, [{ region: transformRegion(polygonRegion(points), circle.center, material.angle), kind: 0 }]);
  return next === state ? state : { ...next, params: { ...next.params, pairA: inside ? material.id : state.params.nextId, pairB: inside ? state.params.nextId : material.id, region: 0 } };
}

export const curvePairDistance = (state: PlanarState) => {
  const a = curveMaterial(state, state.params.pairA), b = curveMaterial(state, state.params.pairB);
  return a && b ? distance(a.origin, b.origin) : 0;
};

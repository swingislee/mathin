import type { PlanarPoint as Point, PlanarState } from "../planar-kit/contract";
import { add, direction, distance, normalizeTurn, POLYGON_DIMENSIONS, POLYGON_LIMIT, POLYGON_SCENE, POLYGON_UNIT, polygonCornerGeometry, polygonJoinedCorners, polygonLocalVertices, polygonMaterial, polygonMaterials, polygonThreeRods, rotate, subtract, toLocal, toWorld, type Dimension, type PolygonKind, type PolygonMaterial } from "./geometry";
import { isValidPolygonWorkbenchState } from "./validation";
export { polygonMaterial, polygonMaterials, polygonLocalVertices, polygonWorldVertices, polygonThreeRods, polygonCornerGeometry, polygonJoinedCorners } from "./geometry";

export function emptyPolygonWorkbenchState(): PlanarState {
  return { sceneId: POLYGON_SCENE, params: { count: 0, active: -1, vertex: 0 }, points: {}, flags: { grid: false, measures: false, names: false }, marks: [], phase: 0 };
}
function encode(state: PlanarState, objects: readonly PolygonMaterial[], active: number, vertex = state.params.vertex): PlanarState {
  const next = emptyPolygonWorkbenchState();
  next.params = { count: objects.length, active: objects.length ? active : -1, vertex };
  next.flags = { grid: state.flags.grid, measures: state.flags.measures, names: state.flags.names };
  objects.forEach((object, id) => {
    Object.assign(next.params, { [`kind.${id}`]: object.kind, [`rotation.${id}`]: object.rotation, [`base.${id}`]: object.base });
    for (const key of POLYGON_DIMENSIONS[object.kind]) next.params[`${key}.${id}`] = object.dimensions[key]!;
    next.points[`origin.${id}`] = object.origin;
    object.vertices.forEach((at, index) => { next.points[`vertex.${id}.${index}`] = at; });
    next.flags[`height.${id}`] = object.height; next.flags[`angles.${id}`] = !!object.corners;
    object.corners?.forEach((corner, index) => { next.points[`corner.${id}.${index}`] = corner.at; next.params[`turn.${id}.${index}`] = corner.turn; });
  });
  return isValidPolygonWorkbenchState(next) ? next : state;
}
function replace(state: PlanarState, object: PolygonMaterial, vertex = state.params.vertex) {
  return encode(state, polygonMaterials(state).map((item) => item.id === object.id ? object : item), object.id, vertex);
}
function material(kind: PolygonKind, id: number, origin: Point): PolygonMaterial {
  const defaults = { width: 200, left: 150, right: 170, height: 140, shift: 60, top: 125, opening: 65, side: 1 };
  return { id, kind, origin, rotation: 0, base: 0, height: false, corners: null,
    dimensions: Object.fromEntries(POLYGON_DIMENSIONS[kind].map((key) => [key, defaults[key]])),
    vertices: kind === 3 ? [{ x: 0, y: 0 }, { x: 220, y: 0 }, { x: 70, y: -160 }]
      : kind === 4 ? [{ x: 0, y: 0 }, { x: 210, y: 20 }, { x: 160, y: -145 }, { x: -35, y: -90 }] : [] };
}
export function addPolygonMaterial(state: PlanarState, kind: PolygonKind): PlanarState {
  if (!Number.isInteger(kind) || kind < 0 || kind > 9 || state.params.count >= POLYGON_LIMIT) return state;
  const id = state.params.count, object = material(kind, id, { x: 150 + id % 4 * 120, y: 350 + Math.floor(id / 4) * 45 });
  return encode(state, [...polygonMaterials(state), object], id, 0);
}
export function createPolygonWorkbenchState(): PlanarState {
  let state = addPolygonMaterial(emptyPolygonWorkbenchState(), 3);
  state = addPolygonMaterial(state, 2);
  return replace(state, { ...polygonMaterial(state)!, origin: { x: 590, y: 365 } });
}
export function createPolygonGeometry(state: PlanarState, tool: string, points: readonly Point[]): PlanarState | null {
  const kinds: Record<string, PolygonKind> = { rod: 0, rods: 1, frame: 2, triangle: 3, quadrilateral: 4, rectangle: 5, square: 6 };
  const kind = kinds[tool], count = kind === 0 || kind === 5 || kind === 6 ? 2 : kind === 4 ? 4 : 3;
  if (kind === undefined || points.length !== count || state.params.count >= POLYGON_LIMIT) return null;
  let object = material(kind, state.params.count, points[0]);
  const ab = subtract(points[1], points[0]), width = Math.hypot(ab.x, ab.y);
  if (kind === 3 || kind === 4) object = { ...object, vertices: points.map((p) => subtract(p, points[0])) };
  else if (kind === 5 || kind === 6) {
    object = { ...object, origin: { x: Math.min(points[0].x, points[1].x), y: Math.max(points[0].y, points[1].y) },
      dimensions: kind === 6 ? { width: Math.min(Math.abs(ab.x), Math.abs(ab.y)) } : { width: Math.abs(ab.x), height: Math.abs(ab.y) } };
  } else {
    object = { ...object, rotation: normalizeTurn(direction(ab)), dimensions: { ...object.dimensions, width } };
    if (kind === 1) object.dimensions = { width, left: distance(points[0], points[2]), right: distance(points[1], points[2]), side: toLocal(object, points[2]).y > 0 ? -1 : 1 };
    if (kind === 2) {
      const side = toLocal(object, points[2]);
      object.dimensions = { width, left: Math.hypot(side.x, side.y), opening: Math.abs(direction(side)), side: side.y > 0 ? -1 : 1 };
    }
  }
  const next = encode(state, [...polygonMaterials(state), object], object.id, 0); return next === state ? null : next;
}
export function duplicatePolygonMaterial(state: PlanarState): PlanarState {
  const object = polygonMaterial(state); if (!object || state.params.count >= POLYGON_LIMIT) return state;
  return encode(state, [...polygonMaterials(state), { ...object, id: state.params.count, origin: add(object.origin, { x: 30, y: 30 }) }], state.params.count, 0);
}
export function removePolygonMaterial(state: PlanarState): PlanarState {
  if (!polygonMaterial(state)) return state;
  return encode(state, polygonMaterials(state).filter((o) => o.id !== state.params.active), Math.max(0, Math.min(state.params.active, state.params.count - 2)), 0);
}
export function polygonTarget(target: string | null) {
  const hit = target?.match(/^polygon\.(0|[1-9]\d*)\.(body|vertex|edge|corner)(?:\.([0-3]))?$/);
  if (!hit || (hit[2] === "body") !== (hit[3] === undefined)) return null;
  return { id: Number(hit[1]), part: hit[2] as "body" | "vertex" | "edge" | "corner", index: Number(hit[3] ?? 0) };
}
export function activatePolygonMaterial(state: PlanarState, target: string): PlanarState {
  const hit = polygonTarget(target), object = hit && polygonMaterial(state, hit.id); if (!hit || !object) return state;
  const vertices = polygonLocalVertices(object);
  if (hit.part === "corner" && (!object.corners || hit.index > 2) || hit.index >= vertices.length) return state;
  const next = { ...object, base: hit.part === "edge" && object.kind >= 2 ? hit.index : object.base };
  return replace(state, next, hit.part === "vertex" || hit.part === "corner" ? hit.index : state.params.vertex);
}
function editVertex(object: PolygonMaterial, index: number, point: Point): PolygonMaterial {
  if (object.corners) return object;
  if (object.kind === 3 || object.kind === 4) return { ...object, vertices: object.vertices.map((p, i) => i === index ? point : p) };
  if (index === 0) return { ...object, origin: toWorld(object, point) };
  const d = { ...object.dimensions };
  if (object.kind === 0) return { ...object, rotation: normalizeTurn(object.rotation + direction(point)), dimensions: { width: Math.hypot(point.x, point.y) } };
  if (object.kind === 1) {
    if (index === 1) d.width = point.x;
    const closed = polygonThreeRods(d.width!, d.left!, d.right!, d.side!).closed;
    if (index >= 2 && closed) {
      d.left = Math.hypot(point.x, point.y); d.right = distance(point, { x: d.width!, y: 0 }); d.side = point.y > 0 ? -1 : 1;
    } else {
      if (index === 2) d.left = Math.hypot(point.x, point.y);
      if (index === 3) d.right = distance(point, { x: d.width!, y: 0 });
    }
  } else if (index === 1) {
    d.width = point.x;
  } else if (object.kind === 2 || object.kind === 8) {
    const side = { x: point.x - (index === 2 ? d.width! : 0), y: point.y };
    d.opening = -direction(side) * (d.side ?? 1);
    // 活动框架及菱形的关节只改变开角，直接拖动始终保留杆长/边长。
  } else if (object.kind === 5) {
    d.height = -point.y; if (index === 2) d.width = point.x;
  } else if (object.kind === 6) {
    d.width = index === 3 ? -point.y : (point.x - point.y) / 2;
  } else if (object.kind === 7) {
    d.height = -point.y; d.shift = point.x - (index === 2 ? d.width! : 0);
  } else if (object.kind === 9) {
    d.height = -point.y; if (index === 3) d.shift = point.x; else d.top = point.x - d.shift!;
  }
  return { ...object, dimensions: d };
}
export function dragPolygonMaterial(state: PlanarState, target: string, _point: Point, delta: Point): PlanarState {
  const hit = polygonTarget(target), object = hit && polygonMaterial(state, hit.id); if (!hit || !object) return state;
  if (hit.part === "body" || hit.part === "edge") return replace(state, { ...object, origin: add(object.origin, delta) });
  if (hit.part === "corner") {
    if (!object.corners || hit.index > 2) return state;
    const shift = rotate(delta, -object.rotation);
    return replace(state, { ...object, corners: object.corners.map((corner, i) => i === hit.index ? { ...corner, at: add(corner.at, shift) } : corner) }, hit.index);
  }
  const vertices = polygonLocalVertices(object);
  if (hit.index >= vertices.length || object.corners) return state;
  // 以实际控制点加累计位移，保留指尖在命中圆内的抓取偏差。
  const point = add(toWorld(object, vertices[hit.index]), delta);
  return replace(state, editVertex(object, hit.index, toLocal(object, point)), hit.index);
}
export function setPolygonField(state: PlanarState, key: string, value: number): PlanarState {
  if (!Number.isFinite(value)) return state;
  const object = polygonMaterial(state); if (!object) return state;
  if (key === "x" || key === "y") return replace(state, { ...object, origin: { ...object.origin, [key]: value * POLYGON_UNIT } });
  if (key === "rotation") return replace(state, { ...object, rotation: normalizeTurn(value) });
  if (POLYGON_DIMENSIONS[object.kind].includes(key as Dimension)) return object.corners ? state : replace(state, { ...object,
    dimensions: { ...object.dimensions, [key]: key === "opening" || key === "side" ? value : value * POLYGON_UNIT } });
  if (key === "pointX" || key === "pointY") {
    const vertices = polygonLocalVertices(object), index = Math.min(state.params.vertex, vertices.length - 1), world = toWorld(object, vertices[index]);
    const next = { ...world, [key === "pointX" ? "x" : "y"]: value * POLYGON_UNIT };
    return dragPolygonMaterial(state, `polygon.${object.id}.vertex.${index}`, next, subtract(next, world));
  }
  if (object.corners && ["cornerX", "cornerY", "cornerTurn"].includes(key)) {
    const index = Math.min(2, state.params.vertex), corner = object.corners[index];
    const world = toWorld(object, corner.at);
    const next = key === "cornerTurn" ? { ...corner, turn: normalizeTurn(value - object.rotation) }
      : { ...corner, at: toLocal(object, { ...world, [key === "cornerX" ? "x" : "y"]: value * POLYGON_UNIT }) };
    return replace(state, { ...object, corners: object.corners.map((item, i) => i === index ? next : item) }, index);
  }
  return state;
}
export function nextPolygonVertex(state: PlanarState, corner = false): PlanarState {
  const object = polygonMaterial(state); if (!object) return state;
  return replace(state, object, (state.params.vertex + 1) % (corner ? 3 : polygonLocalVertices(object).length));
}
export function togglePolygonHeight(state: PlanarState): PlanarState {
  const object = polygonMaterial(state); return object && object.kind >= 2 ? replace(state, { ...object, height: !object.height }) : state;
}
export function nextPolygonBase(state: PlanarState): PlanarState {
  const object = polygonMaterial(state); return object && object.kind >= 2 ? replace(state, { ...object, base: (object.base + 1) % polygonLocalVertices(object).length }) : state;
}
export function unlockPolygonMaterial(state: PlanarState): PlanarState {
  const object = polygonMaterial(state); if (!object || ![2, 5, 6, 7, 8, 9].includes(object.kind)) return state;
  return replace(state, { ...object, kind: 4, vertices: polygonLocalVertices(object), dimensions: {} });
}
export function togglePolygonCorners(state: PlanarState): PlanarState {
  const object = polygonMaterial(state); if (!object || object.kind !== 3) return state;
  return replace(state, { ...object, corners: object.corners ? null : polygonCornerGeometry(object).map(({ at, turn }) => ({ at, turn: normalizeTurn(turn) })) }, 0);
}
export function arrangePolygonCorners(state: PlanarState, joined: boolean): PlanarState {
  const object = polygonMaterial(state); if (!object || object.kind !== 3 || !object.corners) return state;
  const corners = joined ? polygonJoinedCorners(object) : polygonCornerGeometry(object).map(({ at, turn }) => ({ at, turn: normalizeTurn(turn) }));
  return replace(state, { ...object, corners });
}
/** 角片逐片作 SE(2) 刚体运动；不插值顶点，因此暂停时角度和弧长也不变。 */
export function interpolatePolygonCorners(from: PlanarState, to: PlanarState, progress: number): PlanarState {
  if (progress <= 0) return from; if (progress >= 1) return to;
  const objects = polygonMaterials(from).map((object) => {
    const target = polygonMaterial(to, object.id); if (!object.corners || !target?.corners) return object;
    return { ...object, corners: object.corners.map((corner, i) => {
      const t = Math.max(0, Math.min(1, progress * 3 - i)), destination = target.corners![i];
      return { at: add(corner.at, { x: (destination.at.x - corner.at.x) * t, y: (destination.at.y - corner.at.y) * t }),
        turn: normalizeTurn(corner.turn + normalizeTurn(destination.turn - corner.turn) * t) };
    }) };
  });
  return encode(from, objects, to.params.active);
}
export function shearPolygonFrame(state: PlanarState): PlanarState {
  const object = polygonMaterial(state); return object?.kind === 2 ? replace(state, { ...object,
    dimensions: { ...object.dimensions, opening: object.dimensions.opening! > 90 ? 40 : 130 } }) : state;
}
export function interpolatePolygonFrame(from: PlanarState, to: PlanarState, progress: number): PlanarState {
  if (progress <= 0) return from; if (progress >= 1) return to;
  return encode(from, polygonMaterials(from).map((object) => {
    const target = polygonMaterial(to, object.id); if (object.kind !== 2 || !target || target.kind !== 2) return object;
    return { ...object, dimensions: { ...object.dimensions, opening: object.dimensions.opening! + (target.dimensions.opening! - object.dimensions.opening!) * progress } };
  }), to.params.active);
}
export function extractPolygonRods(state: PlanarState): PlanarState {
  const object = polygonMaterial(state); if (object?.kind !== 1 || state.params.count + 3 > POLYGON_LIMIT) return state;
  const rods = polygonThreeRods(object.dimensions.width!, object.dimensions.left!, object.dimensions.right!, object.dimensions.side!);
  const copies = rods.segments.map(([a, b], i) => ({ ...material(0, state.params.count + i, toWorld(object, a)),
    rotation: normalizeTurn(object.rotation + direction(subtract(b, a))), dimensions: { width: distance(a, b) } }));
  return encode(state, [...polygonMaterials(state), ...copies], state.params.count, 0);
}
export function copyPolygonFromRods(state: PlanarState): PlanarState {
  const object = polygonMaterial(state); if (object?.kind !== 1 || state.params.count >= POLYGON_LIMIT) return state;
  const rods = polygonThreeRods(object.dimensions.width!, object.dimensions.left!, object.dimensions.right!, object.dimensions.side!); if (!rods.closed) return state;
  return encode(state, [...polygonMaterials(state), { ...material(3, state.params.count, add(object.origin, { x: 25, y: 25 })),
    rotation: object.rotation, vertices: rods.points.slice(0, 3) }], state.params.count, 0);
}

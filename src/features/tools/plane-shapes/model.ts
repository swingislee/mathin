import type { PlanarPoint, PlanarState } from "../planar-kit/contract";

export const BASIC_SHAPES_SCENE_ID = "01-basic";
export const MAX_SHAPE_OBJECTS = 8;
export const SHAPE_KINDS = [
  { id: "triangle", zh: "三角形", en: "Triangle", sides: 3, life: false },
  { id: "square", zh: "正方形", en: "Square", sides: 4, life: false },
  { id: "rectangle", zh: "长方形", en: "Rectangle", sides: 4, life: false },
  { id: "parallelogram", zh: "平行四边形", en: "Parallelogram", sides: 4, life: false },
  { id: "trapezoid", zh: "梯形", en: "Trapezoid", sides: 4, life: false },
  { id: "circle", zh: "圆", en: "Circle", sides: 0, life: false },
  { id: "ellipse", zh: "椭圆", en: "Ellipse", sides: 0, life: false },
  { id: "road-sign", zh: "三角路牌正面", en: "Triangular sign face", sides: 3, life: true },
  { id: "window", zh: "方形窗框外轮廓", en: "Square window outline", sides: 4, life: true },
  { id: "door", zh: "门板正面", en: "Door panel face", sides: 4, life: true },
  { id: "clock", zh: "钟面", en: "Clock face", sides: 0, life: true },
  { id: "mirror", zh: "椭圆镜面", en: "Oval mirror surface", sides: 0, life: true },
] as const;

export interface ShapeObject {
  index: number;
  kind: number;
  scale: number;
  angle: number;
  detail: number;
  center: PlanarPoint;
}
export type ShapeOutline =
  | { type: "polygon"; vertices: readonly PlanarPoint[] }
  | { type: "circle" | "ellipse"; rx: number; ry: number };
export type ShapeTarget = { type: "object" | "edge" | "vertex" | "boundary"; index: number; part?: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const validIndex = (state: PlanarState, index: number) => Number.isInteger(index) && index >= 0 && index < state.params.count;

/** 材料只作相似变换；名称所表示的图形不会被顶点拖动意外改变。 */
export function shapeOutline(kind: number): ShapeOutline {
  switch (kind) {
    case 0: case 7:
      return { type: "polygon", vertices: [{ x: 0, y: -112 }, { x: 120, y: 96 }, { x: -120, y: 96 }] };
    case 1: case 8:
      return { type: "polygon", vertices: [{ x: -100, y: -100 }, { x: 100, y: -100 }, { x: 100, y: 100 }, { x: -100, y: 100 }] };
    case 3:
      return { type: "polygon", vertices: [{ x: -90, y: -90 }, { x: 140, y: -90 }, { x: 90, y: 90 }, { x: -140, y: 90 }] };
    case 4:
      return { type: "polygon", vertices: [{ x: -75, y: -85 }, { x: 75, y: -85 }, { x: 130, y: 85 }, { x: -130, y: 85 }] };
    case 5: case 10: return { type: "circle", rx: 106, ry: 106 };
    case 6: return { type: "ellipse", rx: 140, ry: 90 };
    case 11: return { type: "ellipse", rx: 92, ry: 140 };
    case 9:
      return { type: "polygon", vertices: [{ x: -90, y: -140 }, { x: 90, y: -140 }, { x: 90, y: 140 }, { x: -90, y: 140 }] };
    default:
      return { type: "polygon", vertices: [{ x: -130, y: -84 }, { x: 130, y: -84 }, { x: 130, y: 84 }, { x: -130, y: 84 }] };
  }
}

export function shapeObject(state: PlanarState, index = state.params.active): ShapeObject | null {
  if (!validIndex(state, index)) return null;
  return { index, kind: state.params[`kind${index}`], scale: state.params[`scale${index}`], angle: state.params[`angle${index}`], detail: state.params[`detail${index}`], center: state.points[`object${index}`] };
}

export function shapePoint(object: ShapeObject, point: PlanarPoint): PlanarPoint {
  const angle = object.angle * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: object.center.x + object.scale * (point.x * cos - point.y * sin), y: object.center.y + object.scale * (point.x * sin + point.y * cos) };
}

export function shapeVertices(object: ShapeObject): PlanarPoint[] {
  const outline = shapeOutline(object.kind);
  return outline.type === "polygon" ? outline.vertices.map((point) => shapePoint(object, point)) : [];
}

export function shapeBounds(object: ShapeObject) {
  const outline = shapeOutline(object.kind), vertices = shapeVertices(object);
  if (outline.type === "polygon") return {
    minX: Math.min(...vertices.map((point) => point.x)), maxX: Math.max(...vertices.map((point) => point.x)),
    minY: Math.min(...vertices.map((point) => point.y)), maxY: Math.max(...vertices.map((point) => point.y)),
  };
  const angle = object.angle * Math.PI / 180;
  const x = object.scale * Math.hypot(outline.rx * Math.cos(angle), outline.ry * Math.sin(angle));
  const y = object.scale * Math.hypot(outline.rx * Math.sin(angle), outline.ry * Math.cos(angle));
  return { minX: object.center.x - x, maxX: object.center.x + x, minY: object.center.y - y, maxY: object.center.y + y };
}

export function parseShapeTarget(target: string): ShapeTarget | null {
  const match = /^(object|boundary)\.([0-7])$|^(edge|vertex)\.([0-7])\.([0-3])$/.exec(target);
  if (!match) return null;
  return match[1]
    ? { type: match[1] as "object" | "boundary", index: Number(match[2]) }
    : { type: match[3] as "edge" | "vertex", index: Number(match[4]), part: Number(match[5]) };
}

export function shapeTargetIsValid(state: PlanarState, target: ShapeTarget): boolean {
  const object = shapeObject(state, target.index);
  if (!object) return false;
  const sides = SHAPE_KINDS[object.kind]?.sides;
  if (sides === undefined) return false;
  return target.type === "object" || (target.type === "boundary" ? sides === 0 : target.part !== undefined && target.part >= 0 && target.part < sides);
}

export function createPlaneShapesState(): PlanarState {
  return {
    sceneId: BASIC_SHAPES_SCENE_ID,
    params: { count: 1, active: 0, kind0: 2, scale0: 1, angle0: 0, detail0: 0 },
    points: { object0: { x: 480, y: 360 } },
    flags: { grid: false, measures: true, edges: false, vertices: false, names: false },
    marks: [], phase: 0,
  };
}

function writeObject(state: PlanarState, object: ShapeObject): PlanarState {
  const i = object.index;
  return { ...state,
    params: { ...state.params, [`kind${i}`]: object.kind, [`scale${i}`]: object.scale, [`angle${i}`]: object.angle, [`detail${i}`]: object.detail },
    points: { ...state.points, [`object${i}`]: object.center },
  };
}

function keepInStage(object: ShapeObject): ShapeObject {
  const bounds = shapeBounds({ ...object, center: { x: 0, y: 0 } });
  return { ...object, center: {
    x: clamp(object.center.x, Math.max(60, 32 - bounds.minX), Math.min(900, 928 - bounds.maxX)),
    y: clamp(object.center.y, Math.max(60, 32 - bounds.minY), Math.min(660, 650 - bounds.maxY)),
  } };
}

export function addShapeObject(state: PlanarState, kind: number): PlanarState {
  if (state.params.count >= MAX_SHAPE_OBJECTS || !Number.isInteger(kind) || !SHAPE_KINDS[kind]) return state;
  const index = state.params.count;
  const placements = [{ x: 480, y: 360 }, { x: 680, y: 280 }, { x: 260, y: 300 }, { x: 490, y: 530 }, { x: 470, y: 170 }, { x: 730, y: 510 }, { x: 230, y: 510 }, { x: 270, y: 170 }];
  return writeObject({ ...state, params: { ...state.params, count: index + 1, active: index } }, keepInStage({ index, kind, scale: 1, angle: 0, detail: SHAPE_KINDS[kind].life ? 1 : 0, center: placements[index] }));
}

export function selectShapeTarget(state: PlanarState, target: string): PlanarState {
  const parsed = parseShapeTarget(target);
  if (!parsed || !shapeTargetIsValid(state, parsed)) return state;
  const selected = state.params.active === parsed.index ? state : { ...state, params: { ...state.params, active: parsed.index } };
  if (parsed.type === "object" || (parsed.type === "vertex" ? !state.flags.vertices : !state.flags.edges)) return selected;
  return { ...selected, marks: state.marks.includes(target) ? state.marks.filter((mark) => mark !== target) : [...state.marks, target] };
}

export function moveShapeObject(state: PlanarState, target: string, delta: PlanarPoint): PlanarState {
  const parsed = parseShapeTarget(target);
  if (!parsed || parsed.type !== "object" || !shapeTargetIsValid(state, parsed) || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return state;
  const object = shapeObject(state, parsed.index)!;
  return writeObject({ ...state, params: { ...state.params, active: parsed.index } }, keepInStage({ ...object, center: { x: object.center.x + delta.x, y: object.center.y + delta.y } }));
}

export function setShapeField(state: PlanarState, key: string, value: number): PlanarState {
  const object = shapeObject(state);
  if (!object || !Number.isFinite(value)) return state;
  if (key === "scale") return writeObject(state, keepInStage({ ...object, scale: clamp(value, 0.5, 2) }));
  if (key === "angle") return writeObject(state, keepInStage({ ...object, angle: clamp(value, -36000, 36000) }));
  if (key === "detail" && SHAPE_KINDS[object.kind].life) return writeObject(state, { ...object, detail: clamp(value, 0, 1) });
  return state;
}

export function rotateShapeObject(state: PlanarState, degrees: number): PlanarState {
  const object = shapeObject(state);
  return object ? setShapeField(state, "angle", object.angle + degrees) : state;
}

export function toggleShapeFlag(state: PlanarState, key: string, value = !state.flags[key]): PlanarState {
  return ["grid", "measures", "edges", "vertices", "names"].includes(key) ? { ...state, flags: { ...state.flags, [key]: value } } : state;
}

export function toggleShapeDetail(state: PlanarState): PlanarState {
  const object = shapeObject(state);
  return object && SHAPE_KINDS[object.kind].life ? setShapeField(state, "detail", object.detail > 0.5 ? 0 : 1) : state;
}

export function duplicateShapeObject(state: PlanarState): PlanarState {
  const object = shapeObject(state);
  if (!object || state.params.count >= MAX_SHAPE_OBJECTS) return state;
  const index = state.params.count;
  let copy = keepInStage({ ...object, index, center: { x: object.center.x + 48, y: object.center.y + 48 } });
  if (Math.hypot(copy.center.x - object.center.x, copy.center.y - object.center.y) < 20) {
    copy = keepInStage({ ...object, index, center: { x: object.center.x - 48, y: object.center.y - 48 } });
  }
  return writeObject({ ...state, params: { ...state.params, count: index + 1, active: index } }, copy);
}

/** 连续槽在删除时一起重排，观察标记继续关联原来的边与顶点。 */
export function removeShapeObject(state: PlanarState): PlanarState {
  const removed = shapeObject(state);
  if (!removed) return state;
  const count = state.params.count - 1;
  let next: PlanarState = { ...state, params: { count, active: count ? Math.min(removed.index, count - 1) : -1 }, points: {}, marks: [] };
  for (let source = 0; source < state.params.count; source++) {
    if (source === removed.index) continue;
    next = writeObject(next, { ...shapeObject(state, source)!, index: source > removed.index ? source - 1 : source });
  }
  next.marks = state.marks.flatMap((mark) => {
    const target = parseShapeTarget(mark);
    if (!target || target.index === removed.index) return [];
    const index = target.index > removed.index ? target.index - 1 : target.index;
    return [`${target.type}.${index}${target.part === undefined ? "" : `.${target.part}`}`];
  });
  return next;
}

export function shapeCounts(kind: number) {
  const sides = SHAPE_KINDS[kind]?.sides ?? 0;
  return { straightEdges: sides, vertices: sides, curvedBoundary: sides === 0 };
}

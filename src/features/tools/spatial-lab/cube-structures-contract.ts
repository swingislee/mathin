import {
  FACE_OFFSETS,
  analyzeVoxelSurfaceArea,
  createVoxelSet,
  exteriorVoxelFaces,
  projectVoxels,
  voxelKey,
  type Axis,
  type FaceDirection,
  type VoxelCoordinate,
  type VoxelFaceSelection,
} from "@/features/spatial-math/domain";
import type { VoxelRenderModel } from "@/features/spatial-math/renderer-r3f/voxel-render-model";
import { cubeWorkbenchCamera } from "./cube-workbench-camera";

/** 本地验收草稿；正式课堂接入前保持独立版本，不改写冻结 spatial-page-v1。 */
export const CUBE_STRUCTURES_DRAFT_VERSION = "cube-structures-draft-v3" as const;
export const CUBE_STRUCTURES_LIMITS = { cubes: 512, steps: 256, coordinate: 12, displayOffset: 24 } as const;
export const CUBE_COLORS = ["#8fbf88", "#df8a84", "#edce79", "#7da9ce", "#b39dcc", "#e7e0d0"] as const;
export const CUBE_AXIS_COLORS = { x: "#c64848", y: "#258345", z: "#3267bd" } as const;
export const CUBE_SELECTION_COLOR = "#f2bd30";
export const CUBE_GROUP_COLORS = CUBE_COLORS;
export type CubeColor = (typeof CUBE_COLORS)[number];
/** 分组棱边使用同色系深色，和浅色实体／面高亮保持区分；不改变持久组色。 */
export function cubeGroupOutlineColor(color: CubeColor): string {
  return "#" + [1, 3, 5].map((start) => Math.round(parseInt(color.slice(start, start + 2), 16) * 0.42).toString(16).padStart(2, "0")).join("");
}
export type CubeView = "angle" | "front" | "left" | "right" | "top";
export type CubeTool = "orbit" | "pan" | "select" | "build" | "remove" | "color" | "face" | "move" | "layer" | "cut" | "mark" | "number" | "transparent";
export const CUBE_MARK_SHAPES = ["circle", "triangle", "square", "star", "diamond", "cross"] as const;
export type CubeMarkShape = (typeof CUBE_MARK_SHAPES)[number];
export type CubeLabelPlacement = "side" | "face" | "center";
export interface CubeLabelStyle {
  readonly placement: CubeLabelPlacement;
  readonly direction: FaceDirection;
  readonly color: CubeColor;
}

export interface CubeGroup {
  readonly id: string;
  readonly name: string;
  readonly color: (typeof CUBE_GROUP_COLORS)[number];
  readonly cubeIds: readonly string[];
}

export interface StructureCube {
  readonly id: string;
  readonly position: VoxelCoordinate;
  readonly color: CubeColor;
  /** 整体底色与逐面染色独立，修改底色保留教学用的染色面。 */
  readonly faces: Partial<Record<FaceDirection, CubeColor>>;
  /** 展示位移独立于整数逻辑格；切割间隙不参与数学计算。 */
  readonly displayOffset?: VoxelCoordinate;
  readonly opacity?: number;
  readonly mark?: CubeLabelStyle & { readonly shape: CubeMarkShape };
  readonly numberLabel?: CubeLabelStyle & { readonly value: number };
}

export interface CubeFrame {
  readonly center: VoxelCoordinate;
  readonly radius: number;
}

export interface CubeStructureState {
  readonly cubes: readonly StructureCube[];
  readonly hiddenCubeIds: readonly string[];
  readonly groups: readonly CubeGroup[];
  /** 模型创建时固定在左后下顶点；空白模型在放入第一块时固定。 */
  readonly origin: VoxelCoordinate | null;
  readonly axesVisible: boolean;
  readonly view: CubeView;
  readonly frame: CubeFrame;
  readonly nextCubeId: number;
  readonly nextNumber: number;
  readonly hiddenEdgesVisible: boolean;
}

export type CubeOperation =
  | { readonly kind: "build"; readonly id?: string; readonly groupId?: string; readonly position: VoxelCoordinate; readonly displayOffset?: VoxelCoordinate; readonly color: CubeColor }
  | { readonly kind: "remove"; readonly ids: readonly string[] }
  | { readonly kind: "color"; readonly ids: readonly string[]; readonly color: CubeColor }
  | { readonly kind: "paint"; readonly faces: readonly { readonly id: string; readonly direction: FaceDirection }[]; readonly color: CubeColor }
  | { readonly kind: "clear-paint"; readonly ids: readonly string[] }
  | { readonly kind: "layer"; readonly axis: Axis; readonly index: number; readonly visible: boolean; readonly ids?: readonly string[] }
  | { readonly kind: "show-all"; readonly ids?: readonly string[] }
  | { readonly kind: "group"; readonly id: string; readonly name: string; readonly color?: CubeGroup["color"]; readonly ids: readonly string[] }
  | { readonly kind: "ungroup"; readonly id: string }
  | { readonly kind: "move"; readonly ids: readonly string[]; readonly axis: Axis; readonly distance: number }
  | { readonly kind: "cut"; readonly ids: readonly string[]; readonly scopeIds: readonly string[]; readonly axis: Axis; readonly after: number; readonly side: -1 | 1; readonly distance: number; readonly groupId: string; readonly name: string; readonly color?: CubeGroup["color"] }
  | { readonly kind: "display-move"; readonly ids: readonly string[]; readonly axis: Axis; readonly distance: number }
  | { readonly kind: "display-reset"; readonly ids: readonly string[] }
  | ({ readonly kind: "mark"; readonly ids: readonly string[]; readonly shape: CubeMarkShape } & CubeLabelStyle)
  | ({ readonly kind: "number"; readonly id: string; readonly value?: number } & CubeLabelStyle)
  | { readonly kind: "clear-labels"; readonly ids: readonly string[]; readonly target: "mark" | "number" }
  | { readonly kind: "restart-numbering" }
  | { readonly kind: "opacity"; readonly ids: readonly string[]; readonly opacity: number }
  | { readonly kind: "hidden-edges"; readonly visible: boolean }
  | { readonly kind: "axes"; readonly visible: boolean }
  | { readonly kind: "view"; readonly view: CubeView; readonly frame: CubeFrame };

export interface CubeHistory {
  readonly version: typeof CUBE_STRUCTURES_DRAFT_VERSION;
  readonly initial: CubeStructureState;
  readonly operations: readonly CubeOperation[];
  readonly cursor: number;
}

export function cubeFrame(cubes: readonly StructureCube[]): CubeFrame {
  if (!cubes.length) return { center: { x: 0, y: 0, z: 0 }, radius: 2.5 };
  const positions = cubes.map(cubeDisplayPosition);
  const min = { x: Math.min(...positions.map((p) => p.x)), y: Math.min(...positions.map((p) => p.y)), z: Math.min(...positions.map((p) => p.z)) };
  const max = { x: Math.max(...positions.map((p) => p.x)), y: Math.max(...positions.map((p) => p.y)), z: Math.max(...positions.map((p) => p.z)) };
  return {
    center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 },
    radius: Math.max(2.5, Math.hypot(max.x - min.x + 1, max.y - min.y + 1, max.z - min.z + 1) / 2),
  };
}

export function cubeDisplayPosition(cube: Pick<StructureCube, "position" | "displayOffset">): VoxelCoordinate {
  return { x: cube.position.x + (cube.displayOffset?.x ?? 0), y: cube.position.y + (cube.displayOffset?.y ?? 0), z: cube.position.z + (cube.displayOffset?.z ?? 0) };
}

export function cubeAtDisplayPosition(state: CubeStructureState, position: VoxelCoordinate): StructureCube | undefined {
  return state.cubes.find((cube) => voxelKey(cubeDisplayPosition(cube)) === voxelKey(position));
}

function validDisplayOffset(offset: VoxelCoordinate | undefined): boolean {
  return !offset || [offset.x, offset.y, offset.z].every((value) => Number.isInteger(value * 2) && Math.abs(value) <= CUBE_STRUCTURES_LIMITS.displayOffset);
}

/** 检查展示实体的体积重叠；接触面允许重合，隐藏的实体同样占位。 */
export function cubeDisplayCollides(cubes: readonly StructureCube[], changed: readonly StructureCube[]): boolean {
  return changed.some((cube) => {
    const a = cubeDisplayPosition(cube);
    return cubes.some((other) => {
      if (cube.id === other.id) return false;
      const b = cubeDisplayPosition(other);
      return Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.z - b.z) < 1;
    });
  });
}

export function cubeCutOperation(state: CubeStructureState, scopeIds: readonly string[], axis: Axis, after: number, side: -1 | 1, distance: number, groupId: string, name: string): Extract<CubeOperation, { kind: "cut" }> | null {
  const scoped = state.cubes.filter((cube) => scopeIds.includes(cube.id));
  const ids = scoped.filter((cube) => side > 0 ? cube.position[axis] > after : cube.position[axis] <= after).map((cube) => cube.id);
  if (!Number.isInteger(after) || !ids.length || ids.length === scoped.length) return null;
  return { kind: "cut", ids, scopeIds: scoped.map((cube) => cube.id), axis, after, side, distance, groupId, name };
}

export function createCubeHistory(positions: readonly VoxelCoordinate[]): CubeHistory {
  const cells = createVoxelSet(positions).cells;
  if (cells.length > CUBE_STRUCTURES_LIMITS.cubes || cells.some((cell) => !canPlaceCube(cell))) {
    throw new Error("cube-structures:invalid-initial-model");
  }
  const cubes = cells.map((position, index) => ({ id: `cube-${index + 1}`, position, color: CUBE_COLORS[0], faces: {} }));
  return {
    version: CUBE_STRUCTURES_DRAFT_VERSION,
    initial: { cubes, hiddenCubeIds: [], groups: [], origin: cubeOrigin(cubes), axesVisible: true, view: "angle", frame: cubeFrame(cubes), nextCubeId: cubes.length + 1, nextNumber: 1, hiddenEdgesVisible: true },
    operations: [],
    cursor: 0,
  };
}

export function cubeOrigin(cubes: readonly StructureCube[]): VoxelCoordinate | null {
  if (!cubes.length) return null;
  return { x: Math.min(...cubes.map((cube) => cube.position.x)) - 0.5,
    y: Math.min(...cubes.map((cube) => cube.position.y)) - 0.5,
    z: Math.min(...cubes.map((cube) => cube.position.z)) - 0.5 };
}

export function cubeLayerNumber(state: Pick<CubeStructureState, "origin">, axis: Axis, coordinate: number): number {
  return Math.round(coordinate - (state.origin?.[axis] ?? -0.5) + 0.5);
}

export function cubeScopeIds(state: CubeStructureState, groupId: string | null): readonly string[] {
  return groupId === null ? state.cubes.map((cube) => cube.id)
    : (state.groups.find((group) => group.id === groupId)?.cubeIds ?? []);
}

export function cubeLayerOperation(state: CubeStructureState, axis: Axis, index: number, visible: boolean, scopeIds: readonly string[]): CubeOperation {
  return { kind: "layer", axis, index, visible, ids: state.cubes.filter((cube) => scopeIds.includes(cube.id) && cube.position[axis] === index).map((cube) => cube.id) };
}

export function canPlaceCube(position: VoxelCoordinate): boolean {
  return [position.x, position.y, position.z].every((value) => Number.isInteger(value) && Math.abs(value) <= CUBE_STRUCTURES_LIMITS.coordinate);
}

export function adjacentCube(face: VoxelFaceSelection): VoxelCoordinate {
  const offset = FACE_OFFSETS[face.direction];
  return { x: face.cell.x + offset.x, y: face.cell.y + offset.y, z: face.cell.z + offset.z };
}

export function cubeIsVisible(state: CubeStructureState, cube: StructureCube): boolean {
  return !state.hiddenCubeIds.includes(cube.id);
}

/** 一次确认的用户操作对应一个确定性 command；hover、选中和拖动帧保持本地 UI 状态。 */
export function applyCubeOperation(state: CubeStructureState, operation: CubeOperation): CubeStructureState {
  switch (operation.kind) {
    case "build": {
      if (!canPlaceCube(operation.position) || !validDisplayOffset(operation.displayOffset) || state.cubes.length >= CUBE_STRUCTURES_LIMITS.cubes
        || state.cubes.some((cube) => voxelKey(cube.position) === voxelKey(operation.position) || cube.id === operation.id)
        || (operation.groupId && !state.groups.some((group) => group.id === operation.groupId))) return state;
      const cube = { id: operation.id ?? `cube-${state.nextCubeId}`, position: { ...operation.position }, color: operation.color, faces: {}, ...(operation.displayOffset ? { displayOffset: { ...operation.displayOffset } } : {}) };
      if (cubeDisplayCollides(state.cubes, [cube])) return state;
      return { ...state, origin: state.origin ?? cubeOrigin([cube]), nextCubeId: state.nextCubeId + 1, cubes: [...state.cubes, cube],
        groups: operation.groupId ? state.groups.map((group) => group.id === operation.groupId ? { ...group, cubeIds: [...group.cubeIds, cube.id] } : group) : state.groups };
    }
    case "remove": {
      const ids = new Set(operation.ids);
      const cubes = state.cubes.filter((cube) => !ids.has(cube.id));
      return cubes.length === state.cubes.length ? state : { ...state, cubes,
        hiddenCubeIds: state.hiddenCubeIds.filter((id) => !ids.has(id)),
        groups: state.groups.map((group) => ({ ...group, cubeIds: group.cubeIds.filter((id) => !ids.has(id)) })) };
    }
    case "color":
    case "clear-paint": {
      const ids = new Set(operation.ids);
      let changed = false;
      const cubes = state.cubes.map((cube) => {
        if (!ids.has(cube.id)) return cube;
        if (operation.kind === "color") {
          if (cube.color === operation.color) return cube;
          changed = true;
          return { ...cube, color: operation.color };
        }
        if (Object.keys(cube.faces).length === 0) return cube;
        changed = true;
        return { ...cube, faces: {} };
      });
      return changed ? { ...state, cubes } : state;
    }
    case "paint": {
      const byId = new Map<string, FaceDirection[]>();
      for (const face of operation.faces) byId.set(face.id, [...(byId.get(face.id) ?? []), face.direction]);
      let changed = false;
      const cubes = state.cubes.map((cube) => {
        const directions = byId.get(cube.id);
        if (!directions?.some((direction) => cube.faces[direction] !== operation.color)) return cube;
        changed = true;
        const faces = { ...cube.faces };
        directions.forEach((direction) => { faces[direction] = operation.color; });
        return { ...cube, faces };
      });
      return changed ? { ...state, cubes } : state;
    }
    case "layer": {
      const ids = operation.ids ?? state.cubes.filter((cube) => cube.position[operation.axis] === operation.index).map((cube) => cube.id);
      const hidden = new Set(state.hiddenCubeIds);
      for (const id of ids) { if (operation.visible) hidden.delete(id); else hidden.add(id); }
      const hiddenCubeIds = [...hidden];
      return hiddenCubeIds.length === state.hiddenCubeIds.length && hiddenCubeIds.every((id) => state.hiddenCubeIds.includes(id)) ? state : { ...state, hiddenCubeIds };
    }
    case "show-all": {
      const hiddenCubeIds = operation.ids ? state.hiddenCubeIds.filter((id) => !operation.ids!.includes(id)) : [];
      return hiddenCubeIds.length === state.hiddenCubeIds.length ? state : { ...state, hiddenCubeIds };
    }
    case "group": {
      const cubeIds = [...new Set(operation.ids)].filter((id) => state.cubes.some((cube) => cube.id === id));
      if (!cubeIds.length || !operation.name.trim()) return state;
      const color = operation.color ?? state.groups.find((item) => item.id === operation.id)?.color ?? CUBE_GROUP_COLORS[state.groups.length % CUBE_GROUP_COLORS.length];
      const group = { id: operation.id, name: operation.name.trim().slice(0, 40), color, cubeIds };
      const existing = state.groups.find((item) => item.id === group.id);
      if (existing?.name === group.name && existing.color === group.color && existing.cubeIds.join(":") === cubeIds.join(":")) return state;
      return { ...state, groups: existing ? state.groups.map((item) => item.id === group.id ? group : item) : [...state.groups, group] };
    }
    case "ungroup": return state.groups.some((group) => group.id === operation.id) ? { ...state, groups: state.groups.filter((group) => group.id !== operation.id) } : state;
    case "move": {
      if (!Number.isInteger(operation.distance) || operation.distance === 0) return state;
      const ids = new Set(operation.ids);
      const occupied = new Set(state.cubes.filter((cube) => !ids.has(cube.id)).map((cube) => voxelKey(cube.position)));
      const moved = state.cubes.filter((cube) => ids.has(cube.id)).map((cube) => ({ ...cube,
        position: { ...cube.position, [operation.axis]: cube.position[operation.axis] + operation.distance } }));
      if (!moved.length || moved.some((cube) => !canPlaceCube(cube.position) || occupied.has(voxelKey(cube.position)))) return state;
      const cubes = state.cubes.map((cube) => moved.find((item) => item.id === cube.id) ?? cube);
      if (cubeDisplayCollides(cubes, moved)) return state;
      return { ...state, cubes };
    }
    case "cut": {
      const expected = cubeCutOperation(state, operation.scopeIds, operation.axis, operation.after, operation.side, operation.distance, operation.groupId, operation.name);
      if (!expected || expected.ids.length !== operation.ids.length || expected.ids.some((id) => !operation.ids.includes(id))
        || !operation.name.trim() || state.groups.some((group) => group.id === operation.groupId)
        || operation.distance < 0.5 || operation.distance > 8) return state;
      const moved = applyCubeOperation(state, { kind: "display-move", ids: operation.ids, axis: operation.axis, distance: operation.side * operation.distance });
      if (moved === state) return state;
      return applyCubeOperation(moved, { kind: "group", id: operation.groupId, name: operation.name, color: operation.color, ids: operation.ids });
    }
    case "display-move":
    case "display-reset": {
      if (operation.kind === "display-move" && (!Number.isInteger(operation.distance * 2) || !operation.distance)) return state;
      const changed: StructureCube[] = [];
      const cubes = state.cubes.map((cube) => {
        if (!operation.ids.includes(cube.id)) return cube;
        const offset = cube.displayOffset ?? { x: 0, y: 0, z: 0 };
        const displayOffset = operation.kind === "display-reset" ? { x: 0, y: 0, z: 0 }
          : { ...offset, [operation.axis]: offset[operation.axis] + operation.distance };
        if (voxelKey(offset) === voxelKey(displayOffset)) return cube;
        const result = { ...cube, displayOffset }; changed.push(result); return result;
      });
      if (!changed.length || changed.some((cube) => !validDisplayOffset(cube.displayOffset)) || cubeDisplayCollides(cubes, changed)) return state;
      return { ...state, cubes };
    }
    case "mark":
    case "clear-labels":
    case "opacity": {
      if (operation.kind === "opacity" && (!Number.isFinite(operation.opacity) || operation.opacity < 0 || operation.opacity > 1)) return state;
      let changed = false;
      const cubes = state.cubes.map((cube) => {
        if (!operation.ids.includes(cube.id)) return cube;
        if (operation.kind === "opacity") {
          if ((cube.opacity ?? 1) === operation.opacity) return cube;
          changed = true; return { ...cube, opacity: operation.opacity };
        }
        if (operation.kind === "clear-labels") {
          const key = operation.target === "mark" ? "mark" : "numberLabel";
          if (!cube[key]) return cube;
          changed = true; const result = { ...cube }; delete result[key]; return result;
        }
        const mark = { shape: operation.shape, placement: operation.placement, direction: operation.direction, color: operation.color };
        const opacity = operation.placement === "center" ? Math.min(cube.opacity ?? 1, 0.3) : cube.opacity;
        if (JSON.stringify(cube.mark) === JSON.stringify(mark) && opacity === cube.opacity) return cube;
        changed = true; return { ...cube, mark, ...(opacity !== undefined ? { opacity } : {}) };
      });
      return changed ? { ...state, cubes } : state;
    }
    case "number": {
      const cube = state.cubes.find((item) => item.id === operation.id);
      const value = operation.value ?? state.nextNumber;
      if (!cube || cube.numberLabel || !Number.isInteger(value) || value < 1 || value > 9999 || state.cubes.some((item) => item.numberLabel?.value === value)) return state;
      const numberLabel = { value, placement: operation.placement, direction: operation.direction, color: operation.color };
      return { ...state, nextNumber: Math.max(state.nextNumber, value + 1), cubes: state.cubes.map((item) => item.id !== cube.id ? item
        : { ...item, numberLabel, ...(operation.placement === "center" ? { opacity: Math.min(item.opacity ?? 1, 0.3) } : {}) }) };
    }
    case "restart-numbering": {
      if (state.nextNumber === 1 && !state.cubes.some((cube) => cube.numberLabel)) return state;
      return { ...state, nextNumber: 1, cubes: state.cubes.map((cube) => { const result = { ...cube }; delete result.numberLabel; return result; }) };
    }
    case "hidden-edges": return state.hiddenEdgesVisible === operation.visible ? state : { ...state, hiddenEdgesVisible: operation.visible };
    case "axes": return state.axesVisible === operation.visible ? state : { ...state, axesVisible: operation.visible };
    case "view": return { ...state, view: operation.view, frame: operation.frame };
  }
}

export function replayCubeHistory(history: CubeHistory, cursor = history.cursor): CubeStructureState {
  return history.operations.slice(0, Math.max(0, Math.min(cursor, history.operations.length))).reduce(applyCubeOperation, history.initial);
}

export function appendCubeOperation(history: CubeHistory, operation: CubeOperation): CubeHistory {
  if (history.cursor >= CUBE_STRUCTURES_LIMITS.steps) return history;
  const before = replayCubeHistory(history);
  if (applyCubeOperation(before, operation) === before) return history;
  const captured = captureCubeOperation(before, operation);
  return { ...history, operations: [...history.operations.slice(0, history.cursor), captured], cursor: history.cursor + 1 };
}

export function captureCubeOperation(state: CubeStructureState, operation: CubeOperation): CubeOperation {
  if (operation.kind === "build") return { ...operation, id: operation.id ?? `cube-${state.nextCubeId}` };
  if (operation.kind === "layer") return { ...operation, ids: operation.ids ?? state.cubes.filter((cube) => cube.position[operation.axis] === operation.index).map((cube) => cube.id) };
  if (operation.kind === "show-all") return { ...operation, ids: operation.ids ?? state.cubes.map((cube) => cube.id) };
  if (operation.kind === "group") return { ...operation, color: operation.color ?? state.groups.find((group) => group.id === operation.id)?.color ?? CUBE_GROUP_COLORS[state.groups.length % CUBE_GROUP_COLORS.length] };
  if (operation.kind === "cut") return { ...operation, color: operation.color ?? CUBE_GROUP_COLORS[state.groups.length % CUBE_GROUP_COLORS.length] };
  if (operation.kind === "number") return { ...operation, value: operation.value ?? state.nextNumber };
  return operation;
}

export interface CubeSequenceIssue {
  readonly index: number;
  readonly code: "missing-cube" | "missing-group" | "collision" | "invalid-operation";
}

/** 调序及重录后检查整段依赖，不把“引用还未搭建的块”静默解释成无操作。 */
export function validateCubeSequence(initial: CubeStructureState, operations: readonly CubeOperation[]): CubeSequenceIssue | null {
  let state = initial;
  for (const [index, operation] of operations.entries()) {
    const ids = operation.kind === "cut" ? operation.scopeIds : "ids" in operation ? operation.ids ?? [] : operation.kind === "paint" ? operation.faces.map((face) => face.id) : operation.kind === "number" ? [operation.id] : [];
    if (ids.some((id) => !state.cubes.some((cube) => cube.id === id))) return { index, code: "missing-cube" };
    if (operation.kind === "build") {
      if (operation.groupId && !state.groups.some((group) => group.id === operation.groupId)) return { index, code: "missing-group" };
      if (state.cubes.some((cube) => cube.id === operation.id || voxelKey(cube.position) === voxelKey(operation.position))) return { index, code: "collision" };
      if (!operation.id || !canPlaceCube(operation.position) || state.cubes.length >= CUBE_STRUCTURES_LIMITS.cubes) return { index, code: "invalid-operation" };
    }
    if (operation.kind === "ungroup" && !state.groups.some((group) => group.id === operation.id)) return { index, code: "missing-group" };
    if (operation.kind === "group" && (!operation.ids.length || !operation.name.trim())) return { index, code: "invalid-operation" };
    const next = applyCubeOperation(state, operation);
    if (["move", "display-move", "cut", "build"].includes(operation.kind) && next === state) return { index, code: "collision" };
    if (operation.kind === "display-reset" && next === state && state.cubes.some((cube) => operation.ids.includes(cube.id) && cube.displayOffset && Object.values(cube.displayOffset).some((value) => value !== 0))) return { index, code: "collision" };
    if (operation.kind === "number" && next === state) return { index, code: "invalid-operation" };
    state = next;
  }
  return null;
}

/** 选中的单位块只限制涂色对象；外表面的判定始终使用完整逻辑结构，显隐不制造新外表面。 */
export function exteriorPaintOperation(state: CubeStructureState, ids: readonly string[], color: CubeColor): CubeOperation {
  const idByPosition = new Map(state.cubes.map((cube) => [voxelKey(cube.position), cube.id]));
  const selected = new Set(ids);
  const faces = exteriorVoxelFaces(createVoxelSet(state.cubes.map((cube) => cube.position)))
    .map((face) => ({ id: idByPosition.get(voxelKey(face.cell))!, direction: face.direction }))
    .filter((face) => selected.has(face.id));
  return { kind: "paint", faces, color };
}

export function cubeStructureMetrics(state: CubeStructureState) {
  const voxels = createVoxelSet(state.cubes.map((cube) => cube.position));
  const paintedHistogram = Array.from({ length: 7 }, () => 0);
  for (const cube of state.cubes) paintedHistogram[Object.keys(cube.faces).length] += 1;
  return { volume: state.cubes.length, ...analyzeVoxelSurfaceArea(voxels), paintedHistogram };
}

export function buildCubeStructureRenderModel(state: CubeStructureState, selectedIds: readonly string[], label: string, groupId: string | null = null): VoxelRenderModel {
  const visible = state.cubes.filter((cube) => cubeIsVisible(state, cube));
  const selected = new Set(selectedIds);
  const group = state.groups.find((candidate) => candidate.id === groupId);
  const groupIds = new Set(group?.cubeIds ?? []);
  const center = state.frame.center;
  const projectionView = state.view === "angle" ? "front" : state.view;
  return {
    profile: "standard-4x3", entityId: "cube-structures", label, summary: label,
    background: "paper", lighting: "flat", showAxes: false,
    cells: visible.map((cube) => ({ key: cube.id, ...cubeDisplayPosition(cube), materialToken: cube.color, opacity: cube.opacity, selected: selected.has(cube.id),
      emphasis: selected.has(cube.id) ? { color: CUBE_SELECTION_COLOR, faceOpacity: 0.4, priority: 2 }
        : groupIds.has(cube.id) ? { color: group!.color, edgeColor: cubeGroupOutlineColor(group!.color), faceOpacity: 0.25, priority: 1 } : undefined })),
    totalCellCount: state.cubes.length, hiddenByLayerCount: state.cubes.length - visible.length,
    totalCountRevealed: false, layers: [], projectionView,
    projection: projectVoxels(createVoxelSet(visible.map((cube) => cube.position)), projectionView),
    projectionDepthRevealed: false,
    bounds: { center, radius: state.frame.radius },
    camera: cubeWorkbenchCamera(state.frame, state.view),
  };
}

export function cubePaintGroups(state: CubeStructureState): readonly { readonly color: string; readonly faces: readonly VoxelFaceSelection[] }[] {
  return CUBE_COLORS.map((color) => ({
    color,
    faces: state.cubes.filter((cube) => cubeIsVisible(state, cube)).flatMap((cube) =>
      (Object.entries(cube.faces) as [FaceDirection, CubeColor][]).filter(([, paint]) => paint === color)
        .map(([direction]) => ({ cell: cubeDisplayPosition(cube), direction }))),
  })).filter((group) => group.faces.length > 0);
}

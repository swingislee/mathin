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

/** 本地验收草稿；正式课堂接入前保持独立版本，不改写冻结 spatial-page-v1。 */
export const CUBE_STRUCTURES_DRAFT_VERSION = "cube-structures-draft-v2" as const;
export const CUBE_STRUCTURES_LIMITS = { cubes: 512, steps: 256, coordinate: 12 } as const;
export const CUBE_COLORS = ["#8fbf88", "#df8a84", "#edce79", "#7da9ce", "#b39dcc", "#e7e0d0"] as const;
export const CUBE_AXIS_COLORS = { x: "#c64848", y: "#258345", z: "#3267bd" } as const;
export const CUBE_GROUP_COLORS = ["#f2bd30", "#dc4444", "#3686c9", "#9d57ba", "#239a81", "#e27c2d"] as const;
export type CubeColor = (typeof CUBE_COLORS)[number];
export type CubeView = "angle" | "front" | "right" | "top";
export type CubeTool = "orbit" | "pan" | "select" | "build" | "remove" | "color" | "face" | "move" | "layer";

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
}

export type CubeOperation =
  | { readonly kind: "build"; readonly id?: string; readonly groupId?: string; readonly position: VoxelCoordinate; readonly color: CubeColor }
  | { readonly kind: "remove"; readonly ids: readonly string[] }
  | { readonly kind: "color"; readonly ids: readonly string[]; readonly color: CubeColor }
  | { readonly kind: "paint"; readonly faces: readonly { readonly id: string; readonly direction: FaceDirection }[]; readonly color: CubeColor }
  | { readonly kind: "clear-paint"; readonly ids: readonly string[] }
  | { readonly kind: "layer"; readonly axis: Axis; readonly index: number; readonly visible: boolean; readonly ids?: readonly string[] }
  | { readonly kind: "show-all"; readonly ids?: readonly string[] }
  | { readonly kind: "group"; readonly id: string; readonly name: string; readonly color?: CubeGroup["color"]; readonly ids: readonly string[] }
  | { readonly kind: "ungroup"; readonly id: string }
  | { readonly kind: "move"; readonly ids: readonly string[]; readonly axis: Axis; readonly distance: number }
  | { readonly kind: "axes"; readonly visible: boolean }
  | { readonly kind: "view"; readonly view: CubeView; readonly frame: CubeFrame };

export interface CubeHistory {
  readonly version: typeof CUBE_STRUCTURES_DRAFT_VERSION;
  readonly initial: CubeStructureState;
  readonly operations: readonly CubeOperation[];
  readonly cursor: number;
}

export function cubeFrame(cubes: readonly StructureCube[]): CubeFrame {
  const bounds = createVoxelSet(cubes.map((cube) => cube.position)).bounds;
  if (!bounds) return { center: { x: 0, y: 0, z: 0 }, radius: 2.5 };
  return {
    center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, z: (bounds.minZ + bounds.maxZ) / 2 },
    radius: Math.max(2.5, Math.hypot(bounds.maxX - bounds.minX + 1, bounds.maxY - bounds.minY + 1, bounds.maxZ - bounds.minZ + 1) / 2),
  };
}

export function createCubeHistory(positions: readonly VoxelCoordinate[]): CubeHistory {
  const cells = createVoxelSet(positions).cells;
  if (cells.length > CUBE_STRUCTURES_LIMITS.cubes || cells.some((cell) => !canPlaceCube(cell))) {
    throw new Error("cube-structures:invalid-initial-model");
  }
  const cubes = cells.map((position, index) => ({ id: `cube-${index + 1}`, position, color: CUBE_COLORS[0], faces: {} }));
  return {
    version: CUBE_STRUCTURES_DRAFT_VERSION,
    initial: { cubes, hiddenCubeIds: [], groups: [], origin: cubeOrigin(cubes), axesVisible: true, view: "angle", frame: cubeFrame(cubes), nextCubeId: cubes.length + 1 },
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
      if (!canPlaceCube(operation.position) || state.cubes.length >= CUBE_STRUCTURES_LIMITS.cubes
        || state.cubes.some((cube) => voxelKey(cube.position) === voxelKey(operation.position) || cube.id === operation.id)
        || (operation.groupId && !state.groups.some((group) => group.id === operation.groupId))) return state;
      const cube = { id: operation.id ?? `cube-${state.nextCubeId}`, position: { ...operation.position }, color: operation.color, faces: {} };
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
      return { ...state, groups: [...state.groups.filter((item) => item.id !== group.id), group] };
    }
    case "ungroup": return state.groups.some((group) => group.id === operation.id) ? { ...state, groups: state.groups.filter((group) => group.id !== operation.id) } : state;
    case "move": {
      if (!Number.isInteger(operation.distance) || operation.distance === 0) return state;
      const ids = new Set(operation.ids);
      const occupied = new Set(state.cubes.filter((cube) => !ids.has(cube.id)).map((cube) => voxelKey(cube.position)));
      const moved = state.cubes.filter((cube) => ids.has(cube.id)).map((cube) => ({ ...cube,
        position: { ...cube.position, [operation.axis]: cube.position[operation.axis] + operation.distance } }));
      if (!moved.length || moved.some((cube) => !canPlaceCube(cube.position) || occupied.has(voxelKey(cube.position)))) return state;
      return { ...state, cubes: state.cubes.map((cube) => moved.find((item) => item.id === cube.id) ?? cube) };
    }
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
    const ids = "ids" in operation ? operation.ids ?? [] : operation.kind === "paint" ? operation.faces.map((face) => face.id) : [];
    if (ids.some((id) => !state.cubes.some((cube) => cube.id === id))) return { index, code: "missing-cube" };
    if (operation.kind === "build") {
      if (operation.groupId && !state.groups.some((group) => group.id === operation.groupId)) return { index, code: "missing-group" };
      if (state.cubes.some((cube) => cube.id === operation.id || voxelKey(cube.position) === voxelKey(operation.position))) return { index, code: "collision" };
      if (!operation.id || !canPlaceCube(operation.position) || state.cubes.length >= CUBE_STRUCTURES_LIMITS.cubes) return { index, code: "invalid-operation" };
    }
    if (operation.kind === "ungroup" && !state.groups.some((group) => group.id === operation.id)) return { index, code: "missing-group" };
    if (operation.kind === "group" && (!operation.ids.length || !operation.name.trim())) return { index, code: "invalid-operation" };
    const next = applyCubeOperation(state, operation);
    if (operation.kind === "move" && next === state) return { index, code: "collision" };
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
  const direction = { angle: { x: 1, y: 0.8, z: 1 }, front: { x: 0, y: 0, z: 1 }, right: { x: 1, y: 0, z: 0 }, top: { x: 0, y: 1, z: 0 } }[state.view];
  const center = state.frame.center;
  const distance = state.frame.radius * 4;
  const projectionView = state.view === "angle" ? "front" : state.view;
  return {
    profile: "standard-4x3", entityId: "cube-structures", label, summary: label,
    background: "paper", lighting: "flat", showAxes: false,
    cells: visible.map((cube) => ({ key: cube.id, ...cube.position, materialToken: cube.color, selected: selected.has(cube.id),
      emphasis: selected.has(cube.id) ? { color: group?.color ?? CUBE_GROUP_COLORS[0], faceOpacity: 0.4, priority: 2 }
        : groupIds.has(cube.id) ? { color: group!.color, faceOpacity: 0.25, priority: 1 } : undefined })),
    totalCellCount: state.cubes.length, hiddenByLayerCount: state.cubes.length - visible.length,
    totalCountRevealed: false, layers: [], projectionView,
    projection: projectVoxels(createVoxelSet(visible.map((cube) => cube.position)), projectionView),
    projectionDepthRevealed: false,
    bounds: { center, radius: state.frame.radius },
    camera: {
      id: `cube-structures.${state.view}`, projection: "orthographic", target: center,
      position: { x: center.x + direction.x * distance, y: center.y + direction.y * distance, z: center.z + direction.z * distance },
      up: state.view === "top" ? { x: 0, y: 0, z: -1 } : { x: 0, y: 1, z: 0 }, zoom: 1, fovDegrees: 38,
    },
  };
}

export function cubePaintGroups(state: CubeStructureState): readonly { readonly color: string; readonly faces: readonly VoxelFaceSelection[] }[] {
  return CUBE_COLORS.map((color) => ({
    color,
    faces: state.cubes.filter((cube) => cubeIsVisible(state, cube)).flatMap((cube) =>
      (Object.entries(cube.faces) as [FaceDirection, CubeColor][]).filter(([, paint]) => paint === color)
        .map(([direction]) => ({ cell: cube.position, direction }))),
  })).filter((group) => group.faces.length > 0);
}

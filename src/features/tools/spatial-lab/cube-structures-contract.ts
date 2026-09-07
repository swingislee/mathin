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
export const CUBE_STRUCTURES_DRAFT_VERSION = "cube-structures-draft-v1" as const;
export const CUBE_STRUCTURES_LIMITS = { cubes: 512, steps: 256, coordinate: 12 } as const;
export const CUBE_COLORS = ["#8fbf88", "#df8a84", "#edce79", "#7da9ce", "#b39dcc", "#e7e0d0"] as const;
export type CubeColor = (typeof CUBE_COLORS)[number];
export type CubeView = "angle" | "front" | "right" | "top";
export type CubeTool = "orbit" | "select" | "build" | "remove" | "color" | "face" | "layer";

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
  readonly hiddenLayers: readonly { readonly axis: Axis; readonly index: number }[];
  readonly view: CubeView;
  readonly frame: CubeFrame;
  readonly nextCubeId: number;
}

export type CubeOperation =
  | { readonly kind: "build"; readonly position: VoxelCoordinate; readonly color: CubeColor }
  | { readonly kind: "remove"; readonly ids: readonly string[] }
  | { readonly kind: "color"; readonly ids: readonly string[]; readonly color: CubeColor }
  | { readonly kind: "paint"; readonly faces: readonly { readonly id: string; readonly direction: FaceDirection }[]; readonly color: CubeColor }
  | { readonly kind: "clear-paint"; readonly ids: readonly string[] }
  | { readonly kind: "layer"; readonly axis: Axis; readonly index: number; readonly visible: boolean }
  | { readonly kind: "show-all" }
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
    initial: { cubes, hiddenLayers: [], view: "angle", frame: cubeFrame(cubes), nextCubeId: cubes.length + 1 },
    operations: [],
    cursor: 0,
  };
}

export function canPlaceCube(position: VoxelCoordinate): boolean {
  return [position.x, position.y, position.z].every((value) => Number.isInteger(value) && Math.abs(value) <= CUBE_STRUCTURES_LIMITS.coordinate);
}

export function adjacentCube(face: VoxelFaceSelection): VoxelCoordinate {
  const offset = FACE_OFFSETS[face.direction];
  return { x: face.cell.x + offset.x, y: face.cell.y + offset.y, z: face.cell.z + offset.z };
}

export function cubeIsVisible(state: CubeStructureState, cube: StructureCube): boolean {
  return !state.hiddenLayers.some((layer) => cube.position[layer.axis] === layer.index);
}

/** 一次确认的用户操作对应一个确定性 command；hover、选中和拖动帧保持本地 UI 状态。 */
export function applyCubeOperation(state: CubeStructureState, operation: CubeOperation): CubeStructureState {
  switch (operation.kind) {
    case "build": {
      if (!canPlaceCube(operation.position) || state.cubes.length >= CUBE_STRUCTURES_LIMITS.cubes
        || state.cubes.some((cube) => voxelKey(cube.position) === voxelKey(operation.position))) return state;
      return { ...state, nextCubeId: state.nextCubeId + 1, cubes: [...state.cubes, {
        id: `cube-${state.nextCubeId}`, position: { ...operation.position }, color: operation.color, faces: {},
      }] };
    }
    case "remove": {
      const ids = new Set(operation.ids);
      const cubes = state.cubes.filter((cube) => !ids.has(cube.id));
      return cubes.length === state.cubes.length ? state : { ...state, cubes };
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
      const hidden = state.hiddenLayers.some((layer) => layer.axis === operation.axis && layer.index === operation.index);
      if (hidden === !operation.visible) return state;
      const remaining = state.hiddenLayers.filter((layer) => layer.axis !== operation.axis || layer.index !== operation.index);
      return { ...state, hiddenLayers: operation.visible ? remaining : [...remaining, { axis: operation.axis, index: operation.index }] };
    }
    case "show-all": return state.hiddenLayers.length ? { ...state, hiddenLayers: [] } : state;
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
  return { ...history, operations: [...history.operations.slice(0, history.cursor), operation], cursor: history.cursor + 1 };
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

export function buildCubeStructureRenderModel(state: CubeStructureState, selectedIds: readonly string[], label: string): VoxelRenderModel {
  const visible = state.cubes.filter((cube) => cubeIsVisible(state, cube));
  const selected = new Set(selectedIds);
  const direction = { angle: { x: 1, y: 0.8, z: 1 }, front: { x: 0, y: 0, z: 1 }, right: { x: 1, y: 0, z: 0 }, top: { x: 0, y: 1, z: 0 } }[state.view];
  const center = state.frame.center;
  const distance = state.frame.radius * 4;
  const projectionView = state.view === "angle" ? "front" : state.view;
  return {
    profile: "standard-4x3", entityId: "cube-structures", label, summary: label,
    background: "paper", lighting: "flat", showAxes: true,
    cells: visible.map((cube) => ({ key: cube.id, ...cube.position, materialToken: cube.color, selected: selected.has(cube.id) })),
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

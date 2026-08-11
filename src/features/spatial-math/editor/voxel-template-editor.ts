import { z } from "zod";
import {
  AXES,
  SPATIAL_VOXEL_LIMITS,
  compareVoxelCoordinates,
  parseVoxelSceneAdapterInput,
  voxelKey,
  type Axis,
  type VoxelCoordinate,
  type VoxelSceneAdapterInput,
} from "../domain";

export const VOXEL_TEMPLATE_EDITOR_VERSION = "voxel-template-editor-v1" as const;

export const VOXEL_TEMPLATE_EDITOR_LIMITS = {
  maxAxisSpan: 12,
  maxHistory: 50,
  performanceWarningCells: 2_000,
} as const;

const editorCoordinateSchema = z
  .number()
  .int()
  .min(SPATIAL_VOXEL_LIMITS.minCoordinate)
  .max(SPATIAL_VOXEL_LIMITS.maxCoordinate);

const axisBoundsSchema = z
  .object({ min: editorCoordinateSchema, max: editorCoordinateSchema })
  .strict()
  .superRefine((bounds, context) => {
    if (bounds.max < bounds.min) {
      context.addIssue({ code: "custom", message: "axis bounds must be ordered", path: ["max"] });
    }
    if (bounds.max - bounds.min + 1 > VOXEL_TEMPLATE_EDITOR_LIMITS.maxAxisSpan) {
      context.addIssue({ code: "custom", message: "axis bounds exceed editor span", path: ["max"] });
    }
  });

export const voxelTemplateEditorBoundsSchema = z
  .object({ x: axisBoundsSchema, y: axisBoundsSchema, z: axisBoundsSchema })
  .strict();

export type VoxelTemplateEditorBounds = z.infer<typeof voxelTemplateEditorBoundsSchema>;

interface VoxelTemplateEditorSnapshot {
  readonly cells: readonly VoxelCoordinate[];
  readonly layerAxis: Axis;
  readonly activeLayer: number;
}

export interface VoxelTemplateEditorState {
  readonly editorVersion: typeof VOXEL_TEMPLATE_EDITOR_VERSION;
  readonly draft: VoxelSceneAdapterInput;
  readonly bounds: VoxelTemplateEditorBounds;
  readonly activeLayer: number;
  readonly initial: VoxelTemplateEditorSnapshot;
  readonly past: readonly VoxelTemplateEditorSnapshot[];
  readonly future: readonly VoxelTemplateEditorSnapshot[];
}

export type VoxelTemplateEditorAction =
  | { readonly kind: "axis.select"; readonly axis: Axis }
  | { readonly kind: "layer.select"; readonly coordinate: number }
  | { readonly kind: "cell.toggle"; readonly u: number; readonly v: number }
  | { readonly kind: "history.undo" }
  | { readonly kind: "history.redo" }
  | { readonly kind: "draft.reset" };

export interface VoxelTemplateGridCell {
  readonly u: number;
  readonly v: number;
  readonly coordinate: VoxelCoordinate;
  readonly occupied: boolean;
}

export interface VoxelTemplateEditorView {
  readonly editorVersion: typeof VOXEL_TEMPLATE_EDITOR_VERSION;
  readonly layerAxis: Axis;
  readonly horizontalAxis: Axis;
  readonly verticalAxis: Axis;
  readonly activeLayer: number;
  readonly layers: readonly { readonly coordinate: number; readonly count: number; readonly active: boolean }[];
  readonly columns: readonly number[];
  readonly rows: readonly number[];
  readonly cells: readonly VoxelTemplateGridCell[];
  readonly totalCount: number;
  readonly activeLayerCount: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly isDirty: boolean;
  readonly performanceWarning: boolean;
}

export const VOXEL_TEMPLATE_EDITOR_ERROR_CODES = {
  cellOutOfBounds: "VOXEL_TEMPLATE_EDITOR_CELL_OUT_OF_BOUNDS",
  layerOutOfBounds: "VOXEL_TEMPLATE_EDITOR_LAYER_OUT_OF_BOUNDS",
  lastCellRequired: "VOXEL_TEMPLATE_EDITOR_LAST_CELL_REQUIRED",
  cellLimit: "VOXEL_TEMPLATE_EDITOR_CELL_LIMIT",
} as const;

export type VoxelTemplateEditorErrorCode =
  (typeof VOXEL_TEMPLATE_EDITOR_ERROR_CODES)[keyof typeof VOXEL_TEMPLATE_EDITOR_ERROR_CODES];

export class VoxelTemplateEditorError extends Error {
  constructor(public readonly code: VoxelTemplateEditorErrorCode, message: string) {
    super(message);
    this.name = "VoxelTemplateEditorError";
  }
}

const PLANE_AXES: Readonly<Record<Axis, readonly [Axis, Axis]>> = {
  x: ["z", "y"],
  y: ["x", "z"],
  z: ["x", "y"],
};

function orderedRange(min: number, max: number, descending = false): number[] {
  const values = Array.from({ length: max - min + 1 }, (_, index) => min + index);
  return descending ? values.reverse() : values;
}

function derivedBounds(input: VoxelSceneAdapterInput): VoxelTemplateEditorBounds {
  const derive = (axis: Axis) => {
    const values = input.cells.map((cell) => cell[axis]);
    const min = Math.min(0, ...values);
    const max = Math.max(4, ...values);
    return { min, max };
  };
  return voxelTemplateEditorBoundsSchema.parse({ x: derive("x"), y: derive("y"), z: derive("z") });
}

function snapshot(state: Pick<VoxelTemplateEditorState, "draft" | "activeLayer">): VoxelTemplateEditorSnapshot {
  return {
    cells: state.draft.cells.map((cell) => ({ ...cell })),
    layerAxis: state.draft.layerAxis,
    activeLayer: state.activeLayer,
  };
}

function snapshotsEqual(left: VoxelTemplateEditorSnapshot, right: VoxelTemplateEditorSnapshot): boolean {
  return (
    left.layerAxis === right.layerAxis &&
    left.activeLayer === right.activeLayer &&
    left.cells.length === right.cells.length &&
    left.cells.every((cell, index) => voxelKey(cell) === voxelKey(right.cells[index]))
  );
}

function authoredSnapshotsEqual(left: VoxelTemplateEditorSnapshot, right: VoxelTemplateEditorSnapshot): boolean {
  return (
    left.layerAxis === right.layerAxis &&
    left.cells.length === right.cells.length &&
    left.cells.every((cell, index) => voxelKey(cell) === voxelKey(right.cells[index]))
  );
}

function restore(state: VoxelTemplateEditorState, value: VoxelTemplateEditorSnapshot): VoxelTemplateEditorState {
  return {
    ...state,
    draft: parseVoxelSceneAdapterInput({
      ...state.draft,
      cells: value.cells.map((cell) => ({ ...cell })).sort(compareVoxelCoordinates),
      layerAxis: value.layerAxis,
    }),
    activeLayer: value.activeLayer,
  };
}

function commit(
  state: VoxelTemplateEditorState,
  cells: readonly VoxelCoordinate[],
  layerAxis: Axis,
  activeLayer: number,
): VoxelTemplateEditorState {
  const current = snapshot(state);
  const draft = parseVoxelSceneAdapterInput({
    ...state.draft,
    cells: cells.map((cell) => ({ ...cell })).sort(compareVoxelCoordinates),
    layerAxis,
  });
  return {
    ...state,
    draft,
    activeLayer,
    past: [...state.past, current].slice(-VOXEL_TEMPLATE_EDITOR_LIMITS.maxHistory),
    future: [],
  };
}

function assertInBounds(bounds: VoxelTemplateEditorBounds, coordinate: VoxelCoordinate): void {
  for (const axis of AXES) {
    if (coordinate[axis] < bounds[axis].min || coordinate[axis] > bounds[axis].max) {
      throw new VoxelTemplateEditorError(
        VOXEL_TEMPLATE_EDITOR_ERROR_CODES.cellOutOfBounds,
        `cell ${voxelKey(coordinate)} is outside editor bounds`,
      );
    }
  }
}

export function voxelTemplateGridCoordinate(axis: Axis, layer: number, u: number, v: number): VoxelCoordinate {
  const [horizontalAxis] = PLANE_AXES[axis];
  return {
    x: axis === "x" ? layer : horizontalAxis === "x" ? u : v,
    y: axis === "y" ? layer : horizontalAxis === "y" ? u : v,
    z: axis === "z" ? layer : horizontalAxis === "z" ? u : v,
  };
}

export function createVoxelTemplateEditorState(
  inputValue: unknown,
  boundsValue?: unknown,
): VoxelTemplateEditorState {
  const draft = parseVoxelSceneAdapterInput(inputValue);
  const bounds = boundsValue === undefined
    ? derivedBounds(draft)
    : voxelTemplateEditorBoundsSchema.parse(boundsValue);
  draft.cells.forEach((cell) => assertInBounds(bounds, cell));
  const activeLayer = Math.min(...draft.cells.map((cell) => cell[draft.layerAxis]));
  const initial = { cells: draft.cells, layerAxis: draft.layerAxis, activeLayer };
  return {
    editorVersion: VOXEL_TEMPLATE_EDITOR_VERSION,
    draft,
    bounds,
    activeLayer,
    initial,
    past: [],
    future: [],
  };
}

export function applyVoxelTemplateEditorAction(
  state: VoxelTemplateEditorState,
  action: VoxelTemplateEditorAction,
): VoxelTemplateEditorState {
  if (action.kind === "layer.select") {
    const bounds = state.bounds[state.draft.layerAxis];
    if (action.coordinate < bounds.min || action.coordinate > bounds.max) {
      throw new VoxelTemplateEditorError(
        VOXEL_TEMPLATE_EDITOR_ERROR_CODES.layerOutOfBounds,
        `layer ${action.coordinate} is outside editor bounds`,
      );
    }
    return { ...state, activeLayer: action.coordinate };
  }

  if (action.kind === "axis.select") {
    if (action.axis === state.draft.layerAxis) return state;
    const occupiedLayers = state.draft.cells.map((cell) => cell[action.axis]);
    const activeLayer = occupiedLayers.includes(state.activeLayer)
      ? state.activeLayer
      : Math.min(...occupiedLayers);
    return commit(state, state.draft.cells, action.axis, activeLayer);
  }

  if (action.kind === "cell.toggle") {
    const coordinate = voxelTemplateGridCoordinate(
      state.draft.layerAxis,
      state.activeLayer,
      action.u,
      action.v,
    );
    assertInBounds(state.bounds, coordinate);
    const targetKey = voxelKey(coordinate);
    const occupied = state.draft.cells.some((cell) => voxelKey(cell) === targetKey);
    if (occupied && state.draft.cells.length === 1) {
      throw new VoxelTemplateEditorError(
        VOXEL_TEMPLATE_EDITOR_ERROR_CODES.lastCellRequired,
        "a publishable voxel template requires at least one cell",
      );
    }
    if (!occupied && state.draft.cells.length >= SPATIAL_VOXEL_LIMITS.maxCells) {
      throw new VoxelTemplateEditorError(
        VOXEL_TEMPLATE_EDITOR_ERROR_CODES.cellLimit,
        "voxel template exceeds the scene cell limit",
      );
    }
    const cells = occupied
      ? state.draft.cells.filter((cell) => voxelKey(cell) !== targetKey)
      : [...state.draft.cells, coordinate];
    return commit(state, cells, state.draft.layerAxis, state.activeLayer);
  }

  if (action.kind === "history.undo") {
    const previous = state.past.at(-1);
    if (!previous) return state;
    const restored = restore(state, previous);
    return {
      ...restored,
      past: state.past.slice(0, -1),
      future: [snapshot(state), ...state.future].slice(0, VOXEL_TEMPLATE_EDITOR_LIMITS.maxHistory),
    };
  }

  if (action.kind === "history.redo") {
    const next = state.future[0];
    if (!next) return state;
    const restored = restore(state, next);
    return {
      ...restored,
      past: [...state.past, snapshot(state)].slice(-VOXEL_TEMPLATE_EDITOR_LIMITS.maxHistory),
      future: state.future.slice(1),
    };
  }

  const current = snapshot(state);
  if (snapshotsEqual(current, state.initial)) return state;
  const restored = restore(state, state.initial);
  return {
    ...restored,
    past: [...state.past, current].slice(-VOXEL_TEMPLATE_EDITOR_LIMITS.maxHistory),
    future: [],
  };
}

export function deriveVoxelTemplateEditorView(state: VoxelTemplateEditorState): VoxelTemplateEditorView {
  const layerAxis = state.draft.layerAxis;
  const [horizontalAxis, verticalAxis] = PLANE_AXES[layerAxis];
  const columns = orderedRange(state.bounds[horizontalAxis].min, state.bounds[horizontalAxis].max);
  const rows = orderedRange(state.bounds[verticalAxis].min, state.bounds[verticalAxis].max, true);
  const occupiedKeys = new Set(state.draft.cells.map(voxelKey));
  const cells = rows.flatMap((v) =>
    columns.map((u) => {
      const coordinate = voxelTemplateGridCoordinate(layerAxis, state.activeLayer, u, v);
      return { u, v, coordinate, occupied: occupiedKeys.has(voxelKey(coordinate)) };
    }),
  );
  const layers = orderedRange(state.bounds[layerAxis].min, state.bounds[layerAxis].max).map((coordinate) => ({
    coordinate,
    count: state.draft.cells.filter((cell) => cell[layerAxis] === coordinate).length,
    active: coordinate === state.activeLayer,
  }));
  const activeLayerCount = layers.find((layer) => layer.active)?.count ?? 0;
  return {
    editorVersion: VOXEL_TEMPLATE_EDITOR_VERSION,
    layerAxis,
    horizontalAxis,
    verticalAxis,
    activeLayer: state.activeLayer,
    layers,
    columns,
    rows,
    cells,
    totalCount: state.draft.cells.length,
    activeLayerCount,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    isDirty: !authoredSnapshotsEqual(snapshot(state), state.initial),
    performanceWarning: state.draft.cells.length > VOXEL_TEMPLATE_EDITOR_LIMITS.performanceWarningCells,
  };
}

export function voxelTemplateAdapterInput(state: VoxelTemplateEditorState): VoxelSceneAdapterInput {
  return parseVoxelSceneAdapterInput(state.draft);
}

import { parseSpatialPageDoc, type SpatialPageDoc } from "./page-schema";
import { validateSpatialRuntimeStateForPage } from "./runtime-reducer";
import type { SpatialRuntimeState } from "./runtime-schema";
import { compareVoxelCoordinates, voxelKey } from "./voxel-schema";
import type { Axis, VoxelCoordinate } from "./voxel-types";

export interface SpatialRuntimeVoxelCell {
  readonly cellId: string | null;
  readonly coordinate: VoxelCoordinate;
  readonly materialToken: string;
}

export interface SpatialRuntimeVoxelLayer {
  readonly layerId: string;
  readonly axis: Axis;
  readonly min: number;
  readonly max: number;
  readonly visible: boolean;
  readonly cellCount: number;
}

export interface SpatialRuntimeVoxelEntity {
  readonly entityId: string;
  readonly entityVisible: boolean;
  readonly materialToken: string;
  readonly cells: readonly SpatialRuntimeVoxelCell[];
  readonly visibleCells: readonly SpatialRuntimeVoxelCell[];
  readonly layers: readonly SpatialRuntimeVoxelLayer[];
}

export class SpatialRuntimeVoxelContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpatialRuntimeVoxelContractError";
  }
}

function cellWithinLayer(cell: VoxelCoordinate, layer: SpatialRuntimeVoxelLayer): boolean {
  return cell[layer.axis] >= layer.min && cell[layer.axis] <= layer.max;
}

export function materializeSpatialRuntimeVoxelEntity(
  pageInput: unknown,
  stateInput: unknown,
  entityId: string,
): SpatialRuntimeVoxelEntity {
  const page: SpatialPageDoc = parseSpatialPageDoc(pageInput);
  const state: SpatialRuntimeState = validateSpatialRuntimeStateForPage(page, stateInput);
  const entity = page.scene.model.entities.find((candidate) => candidate.id === entityId);
  if (!entity || entity.type !== "voxel-set") {
    throw new SpatialRuntimeVoxelContractError(`entity must be a voxel-set: ${entityId}`);
  }

  const edit = state.voxelEdits.find((candidate) => candidate.entityId === entityId);
  const removed = new Set(edit?.removedCells.map(voxelKey) ?? []);
  const baseCells = entity.cells
    .filter((cell) => !removed.has(voxelKey(cell)))
    .map((cell) => ({
      cellId: cell.id,
      coordinate: { x: cell.x, y: cell.y, z: cell.z },
      materialToken: cell.materialToken ?? entity.materialToken,
    }));
  const addedCells = (edit?.addedCells ?? []).map((cell) => ({
    cellId: null,
    coordinate: { x: cell.x, y: cell.y, z: cell.z },
    materialToken: entity.materialToken,
  }));
  const cells = [...baseCells, ...addedCells].sort((left, right) =>
    compareVoxelCoordinates(left.coordinate, right.coordinate),
  );
  const layerVisibility = new Map(state.layerVisibility.map((layer) => [layer.layerId, layer.visible]));
  const layers: SpatialRuntimeVoxelLayer[] = page.scene.presentation.layers
    .filter((layer) => layer.selector.kind === "voxel-axis-range" && layer.selector.entityId === entityId)
    .map((layer) => ({
      layerId: layer.id,
      axis: layer.selector.kind === "voxel-axis-range" ? layer.selector.axis : "y",
      min: layer.selector.kind === "voxel-axis-range" ? layer.selector.min : 0,
      max: layer.selector.kind === "voxel-axis-range" ? layer.selector.max : 0,
      visible: layerVisibility.get(layer.id) ?? layer.initiallyVisible,
      cellCount: 0,
    }));
  const countedLayers = layers.map((layer) => ({
    ...layer,
    cellCount: cells.filter((cell) => cellWithinLayer(cell.coordinate, layer)).length,
  }));
  const entityVisible = state.entityVisibility.find((entry) => entry.entityId === entityId)?.visible ?? entity.visible;
  const hiddenByEntityLayer = page.scene.presentation.layers.some(
    (layer) =>
      layer.selector.kind === "entities" &&
      layer.selector.entityIds.includes(entityId) &&
      !(layerVisibility.get(layer.id) ?? layer.initiallyVisible),
  );
  const visibleCells =
    entityVisible && !hiddenByEntityLayer
      ? cells.filter((cell) =>
          countedLayers.every((layer) => !cellWithinLayer(cell.coordinate, layer) || layer.visible),
        )
      : [];

  return {
    entityId,
    entityVisible,
    materialToken: entity.materialToken,
    cells,
    visibleCells,
    layers: countedLayers,
  };
}

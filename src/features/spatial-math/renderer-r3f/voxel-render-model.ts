import {
  isVoxelLayerSceneStepId,
  isVoxelVerifySceneStepId,
  createVoxelSet,
  materializeSpatialRuntimeVoxelEntity,
  parseSpatialPageDoc,
  parseSpatialRuntimeState,
  projectVoxels,
  voxelKey,
  type OrthographicProjection,
  type OrthographicView,
  type SpatialPageDoc,
  type SpatialRuntimeState,
  type VoxelBounds,
} from "../domain";

export const VOXEL_RENDERER_PROFILE = "standard-4x3" as const;
export const VOXEL_RENDERER_MAX_DPR = 1.5;
export type VoxelRendererLocale = "zh" | "en";

export interface VoxelRenderCell {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly materialToken: string;
  readonly selected: boolean;
}

export interface VoxelRenderLayer {
  readonly id: string;
  readonly label: string;
  readonly visible: boolean;
  readonly count: number;
  readonly countRevealed: boolean;
}

export interface VoxelRenderCamera {
  readonly id: string;
  readonly projection: "orthographic" | "perspective";
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly target: { readonly x: number; readonly y: number; readonly z: number };
  readonly up: { readonly x: number; readonly y: number; readonly z: number };
  readonly zoom: number;
  readonly fovDegrees: number;
}

export interface VoxelRenderBounds {
  readonly center: { readonly x: number; readonly y: number; readonly z: number };
  readonly radius: number;
}

export interface VoxelRenderModel {
  readonly profile: typeof VOXEL_RENDERER_PROFILE;
  readonly entityId: string;
  readonly label: string;
  readonly summary: string;
  readonly background: "paper" | "night";
  readonly lighting: "flat" | "soft";
  readonly showAxes: boolean;
  readonly cells: readonly VoxelRenderCell[];
  readonly totalCellCount: number;
  readonly hiddenByLayerCount: number;
  readonly totalCountRevealed: boolean;
  readonly layers: readonly VoxelRenderLayer[];
  readonly projectionView: OrthographicView;
  readonly projection: OrthographicProjection;
  readonly projectionDepthRevealed: boolean;
  readonly camera: VoxelRenderCamera;
  readonly bounds: VoxelRenderBounds;
}

function localized(value: { readonly zh: string; readonly en?: string }, locale: VoxelRendererLocale): string {
  return locale === "en" ? value.en ?? value.zh : value.zh;
}

function boundsModel(bounds: VoxelBounds | null): VoxelRenderBounds {
  if (!bounds) return { center: { x: 0, y: 0, z: 0 }, radius: 1 };
  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
  const radius = Math.max(
    1,
    Math.hypot(bounds.maxX - bounds.minX + 1, bounds.maxY - bounds.minY + 1, bounds.maxZ - bounds.minZ + 1) / 2,
  );
  return { center, radius };
}

export function orthographicViewForVoxelCamera(cameraId: string): OrthographicView {
  if (cameraId.endsWith(".right")) return "right";
  if (cameraId.endsWith(".top")) return "top";
  return "front";
}

export function buildVoxelRenderModel(
  pageInput: unknown,
  stateInput: unknown,
  entityId: string,
  locale: VoxelRendererLocale,
  selectedCellKeys: readonly string[] = [],
): VoxelRenderModel {
  const page: SpatialPageDoc = parseSpatialPageDoc(pageInput);
  const state: SpatialRuntimeState = parseSpatialRuntimeState(stateInput);
  const runtimeEntity = materializeSpatialRuntimeVoxelEntity(page, state, entityId);
  const entity = page.scene.model.entities.find((candidate) => candidate.id === entityId);
  if (!entity || entity.type !== "voxel-set") throw new Error(`entity must be voxel-set: ${entityId}`);
  const selected = new Set(selectedCellKeys);
  const visibleVoxelSet = createVoxelSet(runtimeEntity.visibleCells.map((cell) => cell.coordinate));
  const fullVoxelSet = createVoxelSet(runtimeEntity.cells.map((cell) => cell.coordinate));
  const cameraDefinition = page.scene.presentation.cameraBookmarks.find(
    (camera) => camera.id === state.cameraBookmarkId,
  );
  if (!cameraDefinition) throw new Error(`unknown voxel camera: ${state.cameraBookmarkId}`);
  const projectionView = orthographicViewForVoxelCamera(cameraDefinition.id);
  const countRevealed = isVoxelLayerSceneStepId(state.activeStepId) || isVoxelVerifySceneStepId(state.activeStepId);

  return {
    profile: VOXEL_RENDERER_PROFILE,
    entityId,
    label: localized(entity.label ?? page.scene.title, locale),
    summary: localized(page.scene.accessibility.summary, locale),
    background: page.scene.presentation.background,
    lighting: page.scene.presentation.lighting,
    showAxes: page.scene.presentation.showAxes,
    cells: runtimeEntity.visibleCells.map((cell) => ({
      key: voxelKey(cell.coordinate),
      x: cell.coordinate.x,
      y: cell.coordinate.y,
      z: cell.coordinate.z,
      materialToken: cell.materialToken,
      selected: selected.has(voxelKey(cell.coordinate)),
    })),
    totalCellCount: runtimeEntity.cells.length,
    hiddenByLayerCount: runtimeEntity.cells.length - runtimeEntity.visibleCells.length,
    totalCountRevealed: isVoxelVerifySceneStepId(state.activeStepId),
    layers: runtimeEntity.layers.map((layer) => {
      const definition = page.scene.presentation.layers.find((candidate) => candidate.id === layer.layerId);
      return {
        id: layer.layerId,
        label: definition ? localized(definition.label, locale) : layer.layerId,
        visible: layer.visible,
        count: layer.cellCount,
        countRevealed: Boolean(countRevealed),
      };
    }),
    projectionView,
    projection: projectVoxels(visibleVoxelSet, projectionView),
    projectionDepthRevealed: cameraDefinition.projection === "orthographic" || Boolean(countRevealed),
    camera: {
      id: cameraDefinition.id,
      projection: cameraDefinition.projection,
      position: cameraDefinition.position,
      target: cameraDefinition.target,
      up: cameraDefinition.up,
      zoom: cameraDefinition.projection === "orthographic" ? cameraDefinition.zoom : 1,
      fovDegrees: cameraDefinition.projection === "perspective" ? cameraDefinition.fovDegrees : 38,
    },
    bounds: boundsModel(fullVoxelSet.bounds),
  };
}

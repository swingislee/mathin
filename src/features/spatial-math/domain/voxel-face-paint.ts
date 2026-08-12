import { exteriorVoxelFaces } from "./voxel-kernel";
import { voxelKey, type VoxelSet } from "./voxel-schema";
import {
  VOXEL_FACE_PAINT_VERSION,
  compareVoxelFaceSelections,
  parseVoxelFacePaintState,
  parseVoxelFaceSelection,
  type VoxelFacePaintState,
  type VoxelFaceSelection,
} from "./voxel-face-paint-schema";

export interface VoxelFacePaintSummary {
  readonly paintedUnitFaces: number;
  readonly totalExteriorUnitFaces: number;
  readonly complete: boolean;
  readonly histogram: readonly [number, number, number, number, number, number, number];
}

export function voxelFaceSelectionKey(face: VoxelFaceSelection): string {
  return `${voxelKey(face.cell)}:${face.direction}`;
}

function exteriorFaceKeys(voxels: VoxelSet): ReadonlySet<string> {
  return new Set(exteriorVoxelFaces(voxels).map(voxelFaceSelectionKey));
}

function assertExteriorFaces(voxels: VoxelSet, faces: readonly VoxelFaceSelection[]) {
  const exterior = exteriorFaceKeys(voxels);
  for (const face of faces) {
    const key = voxelFaceSelectionKey(face);
    if (!exterior.has(key)) throw new RangeError(`painted face is not exterior: ${key}`);
  }
}

export function createVoxelFacePaintState(input: {
  readonly entityId: string;
  readonly materialToken: string;
  readonly faces?: readonly VoxelFaceSelection[];
}): VoxelFacePaintState {
  return parseVoxelFacePaintState({
    paintVersion: VOXEL_FACE_PAINT_VERSION,
    entityId: input.entityId,
    materialToken: input.materialToken,
    faces: (input.faces ?? [])
      .map((face) => parseVoxelFaceSelection(face))
      .sort(compareVoxelFaceSelections),
  });
}

export function validateVoxelFacePaintState(
  voxels: VoxelSet,
  stateInput: unknown,
): VoxelFacePaintState {
  const state = parseVoxelFacePaintState(stateInput);
  assertExteriorFaces(voxels, state.faces);
  return state;
}

export function toggleExteriorVoxelFacePaint(
  voxels: VoxelSet,
  stateInput: unknown,
  faceInput: unknown,
): VoxelFacePaintState {
  const state = validateVoxelFacePaintState(voxels, stateInput);
  const face = parseVoxelFaceSelection(faceInput);
  assertExteriorFaces(voxels, [face]);
  const key = voxelFaceSelectionKey(face);
  const alreadyPainted = state.faces.some((candidate) => voxelFaceSelectionKey(candidate) === key);
  return createVoxelFacePaintState({
    entityId: state.entityId,
    materialToken: state.materialToken,
    faces: alreadyPainted
      ? state.faces.filter((candidate) => voxelFaceSelectionKey(candidate) !== key)
      : [...state.faces, face],
  });
}

export function paintAllExteriorVoxelFaces(
  voxels: VoxelSet,
  stateInput: unknown,
): VoxelFacePaintState {
  const state = validateVoxelFacePaintState(voxels, stateInput);
  return createVoxelFacePaintState({
    entityId: state.entityId,
    materialToken: state.materialToken,
    faces: exteriorVoxelFaces(voxels).map(({ cell, direction }) => ({ cell, direction })),
  });
}

export function clearVoxelFacePaint(stateInput: unknown): VoxelFacePaintState {
  const state = parseVoxelFacePaintState(stateInput);
  return createVoxelFacePaintState({
    entityId: state.entityId,
    materialToken: state.materialToken,
  });
}

export function summarizeVoxelFacePaint(
  voxels: VoxelSet,
  stateInput: unknown,
): VoxelFacePaintSummary {
  const state = validateVoxelFacePaintState(voxels, stateInput);
  const counts = new Map(voxels.cells.map((cell) => [voxelKey(cell), 0]));
  for (const face of state.faces) {
    const key = voxelKey(face.cell);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const histogram = [0, 0, 0, 0, 0, 0, 0] as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  for (const count of counts.values()) histogram[count] += 1;
  const totalExteriorUnitFaces = exteriorVoxelFaces(voxels).length;
  return {
    paintedUnitFaces: state.faces.length,
    totalExteriorUnitFaces,
    complete: state.faces.length === totalExteriorUnitFaces,
    histogram,
  };
}

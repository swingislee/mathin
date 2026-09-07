import type { Axis, VoxelCoordinate, VoxelFaceSelection } from "@/features/spatial-math/domain";
import { cubeAtDisplayPosition, cubeDisplayPosition, type CubeStructureState } from "./cube-structures-contract";

export interface CubeCutSelection {
  readonly axis: Axis;
  readonly after: number;
  readonly side: -1 | 1;
  readonly ids: readonly string[];
  readonly anchor: VoxelCoordinate;
  readonly cubeId: string;
  readonly face?: VoxelFaceSelection;
  readonly lines?: readonly [CubeCutLine, CubeCutLine];
}

export interface CubeCutLine {
  /** 标识实际展示空间的一段棱边，与材质和实例顺序无关。 */
  readonly key: string;
  readonly along: Axis;
  readonly start: VoxelCoordinate;
  readonly end: VoxelCoordinate;
  readonly cubeIds: readonly string[];
}

export type CubeCutHit = { readonly kind: "edge"; readonly line: CubeCutLine }
  | { readonly kind: "face"; readonly face: VoxelFaceSelection; readonly point: VoxelCoordinate; readonly cubeId: string };
export type CubeCutIssue = "miss" | "scope" | "collinear" | "skew" | "oblique" | "boundary" | "displaced" | "singleLayer";
export interface CubeCutDraft {
  readonly firstLine: CubeCutLine | null;
  readonly selection: CubeCutSelection | null;
  readonly face: VoxelFaceSelection | null;
  readonly issue: CubeCutIssue | null;
}
export const EMPTY_CUBE_CUT: CubeCutDraft = { firstLine: null, selection: null, face: null, issue: null };
const AXES = ["x", "y", "z"] as const;
const EPSILON = 1e-6;

export function cubeCutLayers(state: CubeStructureState, ids: readonly string[], axis: Axis): readonly number[] {
  return [...new Set(state.cubes.filter((cube) => ids.includes(cube.id)).map((cube) => cube.position[axis]))].sort((a, b) => a - b).slice(0, -1);
}

/** 面法向直接决定 XYZ；正/负外侧面向内取最近的层间界面，保留完整单位块。 */
export function cubeCutFromFace(state: CubeStructureState, ids: readonly string[], face: VoxelFaceSelection, point?: VoxelCoordinate): CubeCutSelection | null {
  const cube = cubeAtDisplayPosition(state, face.cell);
  if (!cube || !ids.includes(cube.id)) return null;
  const axis = face.direction[0] as Axis;
  const position = cubeDisplayPosition(cube);
  if (point && AXES.some((value) => value !== axis && Math.abs(point[value] - position[value]) > 0.5 + EPSILON)) return null;
  const side = face.direction[1] === "+" ? 1 : -1;
  const layers = cubeCutLayers(state, ids, axis);
  if (!layers.length) return null;
  const preferred = cube.position[axis] - (side > 0 ? 1 : 0);
  const after = layers.reduce((closest, layer) => Math.abs(layer - preferred) < Math.abs(closest - preferred) ? layer : closest);
  return { axis, after, side, ids: [...ids], cubeId: cube.id, face, anchor: { ...position, [axis]: after + 0.5 + (cube.displayOffset?.[axis] ?? 0) } };
}

/** 两条几何直线先定唯一平面，再映射为保留完整单位块的逻辑层界。 */
export function cubeCutFromLines(state: CubeStructureState, ids: readonly string[], first: CubeCutLine, second: CubeCutLine): { selection: CubeCutSelection | null; issue: CubeCutIssue | null } {
  const fail = (issue: CubeCutIssue) => ({ selection: null, issue });
  if (![first, second].every((line) => line.cubeIds.some((id) => ids.includes(id)))) return fail("scope");
  let axis: Axis;
  if (first.along === second.along) {
    const different = AXES.filter((value) => value !== first.along && Math.abs(first.start[value] - second.start[value]) > EPSILON);
    if (different.length === 0) return fail("collinear");
    if (different.length === 2) return fail("oblique");
    axis = AXES.find((value) => value !== first.along && value !== different[0])!;
  } else {
    axis = AXES.find((value) => value !== first.along && value !== second.along)!;
    if (Math.abs(first.start[axis] - second.start[axis]) > EPSILON) return fail("skew");
  }
  const cubes = state.cubes.filter((cube) => ids.includes(cube.id));
  const offsets = [...new Set(cubes.map((cube) => cube.displayOffset?.[axis] ?? 0))];
  if (offsets.length !== 1) return fail("displaced");
  const boundary = first.start[axis] - offsets[0] - 0.5;
  const after = Math.round(boundary);
  if (Math.abs(after - boundary) > EPSILON || !cubeCutLayers(state, ids, axis).includes(after)) return fail("boundary");
  return { issue: null, selection: { axis, after, side: 1, ids: [...ids], cubeId: first.cubeIds.find((id) => ids.includes(id))!,
    anchor: { x: (second.start.x + second.end.x) / 2, y: (second.start.y + second.end.y) / 2, z: (second.start.z + second.end.z) / 2 }, lines: [first, second] } };
}

/** 悬浮和点击共用同一合同；第一条线、无效第二条线均不生成完整截面。 */
export function cubeCutCandidate(state: CubeStructureState, ids: readonly string[], first: CubeCutLine | null, hit: CubeCutHit | null): { selection: CubeCutSelection | null; issue: CubeCutIssue | null } {
  if (!hit) return { selection: null, issue: "miss" };
  if (hit.kind === "edge") {
    if (!hit.line.cubeIds.some((id) => ids.includes(id))) return { selection: null, issue: "scope" };
    return first ? cubeCutFromLines(state, ids, first, hit.line) : { selection: null, issue: null };
  }
  if (!ids.includes(hit.cubeId)) return { selection: null, issue: "scope" };
  const selection = cubeCutFromFace(state, ids, hit.face, hit.point);
  return { selection, issue: selection ? null : "singleLayer" };
}

export function chooseCubeCut(state: CubeStructureState, ids: readonly string[], draft: CubeCutDraft, hit: CubeCutHit | null): CubeCutDraft {
  if (draft.selection) return draft;
  const result = cubeCutCandidate(state, ids, draft.firstLine, hit);
  if (hit?.kind === "edge" && !draft.firstLine && !result.issue) return { ...EMPTY_CUBE_CUT, firstLine: hit.line };
  return { ...draft, ...result, face: hit?.kind === "face" ? hit.face : draft.face };
}

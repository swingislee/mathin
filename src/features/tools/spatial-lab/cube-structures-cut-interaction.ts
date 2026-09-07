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
  const positions = state.cubes.filter((cube) => ids.includes(cube.id)).map((cube) => cube.position[axis]);
  if (!positions.length) return [];
  const min = Math.min(...positions); const max = Math.max(...positions);
  // 中间有空层时，仍保留能把对象分到两侧的实际整数界面。
  return Array.from({ length: max - min }, (_, index) => min + index);
}

/** 所选面就是截面；外边界明确反馈，保持点击平面与逻辑层界一致。 */
function evaluateCubeCutFace(state: CubeStructureState, ids: readonly string[], face: VoxelFaceSelection, point?: VoxelCoordinate): { selection: CubeCutSelection | null; issue: CubeCutIssue | null } {
  const fail = (issue: CubeCutIssue) => ({ selection: null, issue });
  const cube = cubeAtDisplayPosition(state, face.cell);
  if (!cube) return fail("miss");
  if (!ids.includes(cube.id)) return fail("scope");
  const axis = face.direction[0] as Axis;
  const position = cubeDisplayPosition(cube);
  const side = face.direction[1] === "+" ? 1 : -1;
  const plane = position[axis] + side * 0.5;
  if (point && (Math.abs(point[axis] - plane) > EPSILON || AXES.some((value) => value !== axis && Math.abs(point[value] - position[value]) > 0.5 + EPSILON))) return fail("miss");
  const layers = cubeCutLayers(state, ids, axis);
  if (!layers.length) return fail("singleLayer");
  if (state.cubes.some((other) => ids.includes(other.id) && (other.displayOffset?.[axis] ?? 0) !== (cube.displayOffset?.[axis] ?? 0))) return fail("displaced");
  const after = cube.position[axis] - (side > 0 ? 0 : 1);
  if (!layers.includes(after)) return fail("boundary");
  return { issue: null, selection: { axis, after, side, ids: [...ids], cubeId: cube.id, face, anchor: { ...(point ?? position), [axis]: plane } } };
}

export function cubeCutFromFace(state: CubeStructureState, ids: readonly string[], face: VoxelFaceSelection, point?: VoxelCoordinate): CubeCutSelection | null {
  return evaluateCubeCutFace(state, ids, face, point).selection;
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
  return evaluateCubeCutFace(state, ids, hit.face, hit.point);
}

export function chooseCubeCut(state: CubeStructureState, ids: readonly string[], draft: CubeCutDraft, hit: CubeCutHit | null): CubeCutDraft {
  if (draft.selection) return draft;
  const result = cubeCutCandidate(state, ids, draft.firstLine, hit);
  if (hit?.kind === "edge" && !draft.firstLine && !result.issue) return { ...EMPTY_CUBE_CUT, firstLine: hit.line };
  if (hit?.kind === "face" && result.issue !== "scope" && result.issue !== "miss") return { ...EMPTY_CUBE_CUT, ...result, face: hit.face };
  return { ...draft, ...result };
}

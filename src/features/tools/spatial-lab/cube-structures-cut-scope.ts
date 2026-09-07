import { cubeAtDisplayPosition, cubeDisplayPosition, type CubeStructureState } from "./cube-structures-contract";
import type { CubeCutDraft, CubeCutHit } from "./cube-structures-cut-interaction";

export type CubeCutPieces = ReadonlyMap<string, readonly string[]>;
const AXES = ["x", "y", "z"] as const;
const EPSILON = 1e-6;

/** 展示空间中面相接的单位块属于同一部分；隐藏只改变可见性，仍保留部分成员。 */
export function buildCubeCutPieces(state: CubeStructureState): CubeCutPieces {
  const cubes = state.cubes.map((cube) => ({ id: cube.id, position: cubeDisplayPosition(cube) }));
  const neighbors = cubes.map(() => [] as number[]);
  for (let first = 0; first < cubes.length; first++) for (let second = first + 1; second < cubes.length; second++) {
    const a = cubes[first].position; const b = cubes[second].position;
    if (AXES.some((normal) => Math.abs(Math.abs(a[normal] - b[normal]) - 1) < EPSILON
      && AXES.every((axis) => axis === normal || Math.abs(a[axis] - b[axis]) < 1 - EPSILON))) {
      neighbors[first].push(second); neighbors[second].push(first);
    }
  }
  const pieces = new Map<string, readonly string[]>();
  for (let start = 0; start < cubes.length; start++) {
    if (pieces.has(cubes[start].id)) continue;
    const members = new Set([start]); const queue = [start];
    for (let cursor = 0; cursor < queue.length; cursor++) for (const next of neighbors[queue[cursor]]) {
      if (!members.has(next)) { members.add(next); queue.push(next); }
    }
    const ids = cubes.filter((_, index) => members.has(index)).map((cube) => cube.id);
    for (const id of ids) pieces.set(id, ids);
  }
  return pieces;
}

/** 首次命中决定本刀范围；两线过程中保留第一条所在部分，点击面可重新定面。 */
export function cubeCutScopeIds(state: CubeStructureState, pieces: CubeCutPieces, selectedIds: readonly string[], draft: CubeCutDraft, hit: CubeCutHit | null): readonly string[] {
  if (draft.selection) return draft.selection.ids;
  if (selectedIds.length) return selectedIds;
  if (hit?.kind === "face") return pieces.get(hit.cubeId) ?? [];
  const line = draft.firstLine ?? (hit?.kind === "edge" ? hit.line : null);
  const id = line?.cubeIds.find((member) => pieces.has(member))
    ?? (draft.face ? cubeAtDisplayPosition(state, draft.face.cell)?.id : undefined);
  return id ? pieces.get(id) ?? [] : [];
}

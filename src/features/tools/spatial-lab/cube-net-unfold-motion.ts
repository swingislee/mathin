import type { CubeNetWorkbenchHinge } from "./cube-net-workbench-model";
import type { CubeNetAngles, CubeNetTeachingSnapshot } from "./cube-net-teaching-session";

export const CUBE_NET_UNFOLD_STEP_MS = 650;
export interface CubeNetUnfoldStep {
  readonly edgeId: string;
  readonly movingFaceIds: readonly string[];
}
export interface CubeNetUnfoldFrame extends CubeNetTeachingSnapshot {
  readonly edgeId: string | null;
  readonly movingFaceIds: readonly string[];
  readonly step: number;
  readonly total: number;
}

/** 从当前支撑面建立次序：末端先展开，反向逐面收成立方体，每次只改变一条连接边。 */
export function createCubeNetUnfoldMotion(snapshot: CubeNetTeachingSnapshot, hinges: readonly CubeNetWorkbenchHinge[], rootFaceId: string, targetDegrees: 0 | 90 = 0) {
  const root = snapshot.anchor?.faceId ?? rootFaceId;
  const visited = new Set([root]);
  const traversal: { faceId: string; parentFaceId: string; edgeId: string; depth: number }[] = [];
  const queue = [{ faceId: root, depth: 0 }];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const hinge of hinges) {
      const next = hinge.faceId === current.faceId ? hinge.parentFaceId : hinge.parentFaceId === current.faceId ? hinge.faceId : null;
      if (!next || visited.has(next)) continue;
      visited.add(next);
      traversal.push({ faceId: next, parentFaceId: current.faceId, edgeId: hinge.edgeId, depth: current.depth + 1 });
      queue.push({ faceId: next, depth: current.depth + 1 });
    }
  }
  const steps: CubeNetUnfoldStep[] = traversal.filter((item) => (snapshot.angles[item.edgeId] ?? 0) !== targetDegrees)
    .sort((left, right) => (targetDegrees === 0 ? right.depth - left.depth : left.depth - right.depth) || left.edgeId.localeCompare(right.edgeId))
    .map((item) => {
      const moving = new Set([item.faceId]);
      for (const child of traversal) if (moving.has(child.parentFaceId)) moving.add(child.faceId);
      return { edgeId: item.edgeId, movingFaceIds: [...moving] };
    });
  const durationMs = steps.length * CUBE_NET_UNFOLD_STEP_MS;
  const sample = (elapsedMs: number): CubeNetUnfoldFrame => {
    const elapsed = Math.max(0, Math.min(durationMs, elapsedMs));
    const index = Math.min(steps.length, Math.floor(elapsed / CUBE_NET_UNFOLD_STEP_MS));
    const angles: Record<string, number> = { ...snapshot.angles };
    for (let i = 0; i < index; i++) angles[steps[i].edgeId] = targetDegrees;
    const active = steps[index];
    if (active) {
      const progress = (elapsed - index * CUBE_NET_UNFOLD_STEP_MS) / CUBE_NET_UNFOLD_STEP_MS;
      const eased = progress * progress * (3 - 2 * progress);
      angles[active.edgeId] = (snapshot.angles[active.edgeId] ?? 0) * (1 - eased) + targetDegrees * eased;
    }
    return { angles: angles as CubeNetAngles, anchor: snapshot.anchor, edgeId: active?.edgeId ?? null,
      movingFaceIds: active?.movingFaceIds ?? [], step: Math.min(index + 1, steps.length), total: steps.length };
  };
  return { steps, durationMs, sample };
}

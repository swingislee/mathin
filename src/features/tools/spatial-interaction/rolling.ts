import type { VoxelCoordinate } from "@/features/spatial-math/domain";

export const SPATIAL_ROLL_DIRECTIONS = ["x+", "x-", "z+", "z-"] as const;
export type SpatialRollDirection = typeof SPATIAL_ROLL_DIRECTIONS[number];
export interface SpatialRollPlan {
  axis: "x" | "z"; turn: -1 | 1; pivot: VoxelCoordinate;
  /** 展示用元数据；保存仍只携带领域旋转终点/语义命令。 */
  support?: { virtual: boolean; from: VoxelCoordinate; to: VoxelCoordinate };
}
const EPSILON = 1e-7;

/** 绕行进方向的底部支撑棱翻 90°；不以平移加原地转动代替翻滚。 */
export function planSpatialRoll(vertices: readonly VoxelCoordinate[], direction: SpatialRollDirection): SpatialRollPlan | null {
  if (!vertices.length || vertices.some((p) => !Object.values(p).every(Number.isFinite))) return null;
  const along = direction[0] as "x" | "z", sign = direction[1] === "+" ? 1 : -1;
  const edge = sign > 0 ? Math.max(...vertices.map((p) => p[along])) : Math.min(...vertices.map((p) => p[along]));
  const bottom = Math.min(...vertices.map((p) => p.y));
  const axis = along === "x" ? "z" : "x";
  // 凹形/悬伸拼块用当前世界轴最小外接长方体的底棱作虚拟支撑；不改变模型形状。
  const contacts = vertices.filter((p) => Math.abs(p[along] - edge) < EPSILON && Math.abs(p.y - bottom) < EPSILON);
  const virtual = !contacts.some((p) => contacts.some((q) => Math.abs(p[axis] - q[axis]) > EPSILON));
  const pivot = { x: 0, y: bottom, z: 0, [along]: edge };
  return { pivot, axis, turn: (along === "x" ? -sign : sign) as -1 | 1,
    support: { virtual, from: { ...pivot, [axis]: Math.min(...vertices.map((p) => p[axis])) },
      to: { ...pivot, [axis]: Math.max(...vertices.map((p) => p[axis])) } } };
}
export function spatialRollPoint(point: VoxelCoordinate, plan: SpatialRollPlan, progress = 1): VoxelCoordinate {
  const { pivot, axis, turn } = plan, angle = turn * Math.PI / 2 * Math.max(0, Math.min(1, progress));
  const c = progress === 1 ? 0 : Math.cos(angle), s = progress === 1 ? turn : Math.sin(angle);
  const x = point.x - pivot.x, y = point.y - pivot.y, z = point.z - pivot.z;
  return axis === "z" ? { x: pivot.x + x * c - y * s, y: pivot.y + x * s + y * c, z: point.z }
    : { x: point.x, y: pivot.y + y * c - z * s, z: pivot.z + y * s + z * c };
}
export function unitCubeCorners(centers: readonly VoxelCoordinate[]): VoxelCoordinate[] {
  return centers.flatMap((p) => [-0.5, 0.5].flatMap((x) => [-0.5, 0.5].flatMap((y) => [-0.5, 0.5].map((z) => ({ x: p.x + x, y: p.y + y, z: p.z + z })))));
}

/** 翻动路径也留出空间：转动单位方块与静止方块做二维 SAT，轴向另作区间检查。 */
export function voxelRollIsClear(moving: readonly VoxelCoordinate[], fixed: readonly VoxelCoordinate[], plan: SpatialRollPlan): boolean {
  if (!fixed.length) return true;
  const a = plan.axis === "x" ? "y" : "x", b = plan.axis === "x" ? "z" : "y";
  for (let step = 0; step <= 24; step++) {
    const t = step / 24, angle = plan.turn * Math.PI / 2 * t, c = Math.cos(angle), s = Math.sin(angle);
    const span = 0.5 + (Math.abs(c) + Math.abs(s)) * 0.5;
    for (const source of moving) {
      const p = spatialRollPoint(source, plan, t);
      for (const q of fixed) {
        if (Math.abs(p[plan.axis] - q[plan.axis]) >= 1 - EPSILON) continue;
        const u = q[a] - p[a], v = q[b] - p[b];
        if (Math.abs(u) < span - EPSILON && Math.abs(v) < span - EPSILON
          && Math.abs(u * c + v * s) < span - EPSILON && Math.abs(-u * s + v * c) < span - EPSILON) return false;
      }
    }
  }
  return true;
}

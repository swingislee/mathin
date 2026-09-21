export interface ParameterPoint { x: number; y: number }
/** 连续曲面过程沿材料点的屏幕轨迹求参，局部搜索保持分支连续，避免反面瞬间跳到另一解。 */
export function parameterAlongTrajectory(project: (value: number) => ParameterPoint, pointer: ParameterPoint, previous: number, range = 0.15): number {
  const low = Math.max(0, previous - range), high = Math.min(1, previous + range);
  const previousPoint = project(previous);
  // 平视、转折点或退化轨迹也把当前值保留为候选，静止指针不会被离散网格推动。
  let best = previous, score = (previousPoint.x - pointer.x) ** 2 + (previousPoint.y - pointer.y) ** 2;
  if (!Number.isFinite(score)) score = Infinity;
  for (let i = 0; i <= 90; i++) {
    const value = low + (high - low) * i / 90, p = project(value);
    const distance = (p.x - pointer.x) ** 2 + (p.y - pointer.y) ** 2 + Math.abs(value - previous) * 0.01;
    if (Number.isFinite(distance) && distance < score) { best = value; score = distance; }
  }
  return Math.abs(best) < 0.003 ? 0 : Math.abs(1 - best) < 0.003 ? 1 : best;
}

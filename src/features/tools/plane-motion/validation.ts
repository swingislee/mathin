import type { PlanarState } from "../planar-kit/contract";

const numberIn = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const integerIn = (value: unknown, min: number, max: number) => numberIn(value, min, max) && Number.isInteger(value);
const pointValid = (state: PlanarState, key: string) => state.points[key] !== undefined && numberIn(state.points[key].x, -5000, 5000) && numberIn(state.points[key].y, -5000, 5000);

/** 领域只检查可持久化数学现场，不导入 React descriptor 或通用运行时 schema。 */
export function isValidPlaneMotionState(state: PlanarState): boolean {
  const p = state.params;
  if (!numberIn(state.phase, 0, 1) || state.marks.length > 64 || Object.keys(state.points).length > 64 || Object.keys(p).length > 64) return false;
  switch (state.sceneId) {
    case "20": return numberIn(p.dx, -5000, 5000) && numberIn(p.dy, -5000, 5000);
    case "21": return numberIn(p.angle, -36000, 36000) && pointValid(state, "center");
    case "22": return numberIn(p.axisAngle, -180, 180) && (!state.points.center || pointValid(state, "center"));
    case "24": return integerIn(p.copies, 2, 12) && pointValid(state, "center");
    case "32": {
      if (!numberIn(p.radius, 8, 35) || !pointValid(state, "center") || !pointValid(state, "hole") || typeof state.flags.twice !== "boolean") return false;
      const c = state.points.center, h = state.points.hole;
      return h.x >= c.x - 155 + p.radius && h.x <= c.x - p.radius && h.y >= c.y - 155 + p.radius && h.y <= c.y - p.radius;
    }
    case "36": return integerIn(p.count, 1, 24) && integerIn(p.sides, 3, 6) && integerIn(p.selected, 0, p.count - 1) && Array.from({ length: p.count }, (_, i) => i).every((i) => pointValid(state, `tile${i}`) && (p[`angle${i}`] === undefined || numberIn(p[`angle${i}`], -36000, 36000)));
    case "54": return numberIn(p.axisAngle, -180, 180) && numberIn(p.contact, -3000, 3000) && ["center", "a", "b"].every((key) => pointValid(state, key));
    case "55": return numberIn(p.largeRadius, 90, 180) && numberIn(p.smallRadius, 20, 80) && p.smallRadius < p.largeRadius && numberIn(p.orbit, 90, 720) && pointValid(state, "center");
    default: return false;
  }
}

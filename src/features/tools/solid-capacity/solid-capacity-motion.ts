import type { CapacityVessel, CapacityVesselKind, SolidCapacitySnapshot } from "./solid-capacity-contract";
import { vesselCapacity, vesselLiquidVolume } from "./solid-capacity";

export const CAPACITY_TRANSITION_MS = 1200;
export interface CapacityPresentation { cone: CapacityVessel; cylinder: CapacityVessel; coneAngle: number }
export function capacityPresentation(snapshot: SolidCapacitySnapshot): CapacityPresentation {
  return { cone: { ...snapshot.cone }, cylinder: { ...snapshot.cylinder }, coneAngle: snapshot.coneOrientation === "tip-down" ? Math.PI : 0 };
}
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
export function interpolateCapacity(from: CapacityPresentation, target: CapacityPresentation, progress: number): CapacityPresentation {
  const p = Math.max(0, Math.min(1, progress)), t = p * p * (3 - 2 * p);
  const reorienting = Math.abs(from.coneAngle - target.coneAngle) > 1e-6;
  function vessel(kind: CapacityVesselKind): CapacityVessel {
    const a = from[kind], b = target[kind], dimensions = { radius: lerp(a.radius, b.radius, t), height: lerp(a.height, b.height, t) };
    const volume = kind === "cone" && reorienting
      ? p < 1 / 3 ? vesselLiquidVolume(a, kind) * (1 - p * 3) : p > 2 / 3 ? vesselLiquidVolume(b, kind) * (p * 3 - 2) : 0
      : lerp(vesselLiquidVolume(a, kind), vesselLiquidVolume(b, kind), t);
    return { ...dimensions, fill: Math.max(0, Math.min(1, volume / vesselCapacity(dimensions, kind))) };
  }
  // 改尖端方向时先排空，再翻转，最后恢复目标液量；不画倾斜容器中的虚假水平锥体。
  const angleProgress = reorienting ? Math.max(0, Math.min(1, p * 3 - 1)) : t;
  return { cone: vessel("cone"), cylinder: vessel("cylinder"), coneAngle: lerp(from.coneAngle, target.coneAngle, angleProgress) };
}

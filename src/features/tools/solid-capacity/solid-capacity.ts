import type { CapacityVessel, CapacityVesselKind, ConeOrientation, SolidCapacityInitial, SolidCapacitySnapshot } from "./solid-capacity-contract";

export function vesselCapacity(vessel: Pick<CapacityVessel, "radius" | "height">, kind: CapacityVesselKind): number {
  return Math.PI * vessel.radius ** 2 * vessel.height / (kind === "cone" ? 3 : 1);
}
export function vesselLiquidVolume(vessel: CapacityVessel, kind: CapacityVesselKind): number { return vessel.fill * vesselCapacity(vessel, kind); }
/** 高度从容器最低点量起；圆锥尖端朝下 f=(h/H)^3，朝上 f=1-(1-h/H)^3。 */
export function liquidHeight(vessel: CapacityVessel, kind: CapacityVesselKind, orientation: ConeOrientation = "tip-down"): number {
  const f = Math.max(0, Math.min(1, vessel.fill));
  return vessel.height * (kind === "cylinder" ? f : orientation === "tip-down" ? Math.cbrt(f) : 1 - Math.cbrt(1 - f));
}
export function liquidFractionAtHeight(vessel: Pick<CapacityVessel, "height">, kind: CapacityVesselKind, height: number, orientation: ConeOrientation = "tip-down"): number {
  const t = Math.max(0, Math.min(1, height / vessel.height));
  return kind === "cylinder" ? t : orientation === "tip-down" ? t ** 3 : 1 - (1 - t) ** 3;
}
export function liquidRadii(vessel: CapacityVessel, kind: CapacityVesselKind, orientation: ConeOrientation): { bottom: number; top: number } {
  if (kind === "cylinder") return { bottom: vessel.radius, top: vessel.radius };
  const t = liquidHeight(vessel, kind, orientation) / vessel.height;
  return orientation === "tip-down" ? { bottom: 0, top: vessel.radius * t } : { bottom: vessel.radius, top: vessel.radius * (1 - t) };
}
function snappedFraction(value: number) {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped < 1e-12 ? 0 : clamped > 1 - 1e-12 ? 1 : clamped;
}
export interface CapacityTransfer { snapshot: SolidCapacitySnapshot; amount: number }
/** 转移实际液量；容器不足时余量仍留在来源内，不隐式补水或溢出。 */
export function transferLiquid(snapshot: SolidCapacitySnapshot, from: CapacityVesselKind, requested = Infinity): CapacityTransfer {
  const to = from === "cone" ? "cylinder" : "cone", source = snapshot[from], target = snapshot[to];
  const available = vesselLiquidVolume(source, from), capacity = vesselCapacity(target, to), existing = vesselLiquidVolume(target, to);
  const limit = Number.isFinite(requested) ? Math.max(0, requested) : requested === Infinity ? Infinity : 0;
  const amount = Math.max(0, Math.min(available, capacity - existing, limit));
  if (amount < 1e-12) return { snapshot, amount: 0 };
  return { amount, snapshot: { ...snapshot,
    [from]: { ...source, fill: snappedFraction((available - amount) / vesselCapacity(source, from)) },
    [to]: { ...target, fill: snappedFraction((existing + amount) / capacity) },
  } };
}
/** 改尺寸是重设演示条件，先清空两容器；不把凭空增减的液量伪装成灌入过程。 */
export function resizeCapacityVessel(snapshot: SolidCapacitySnapshot, kind: CapacityVesselKind, key: "radius" | "height", value: number): SolidCapacitySnapshot {
  const next = { ...snapshot, cone: { ...snapshot.cone, fill: 0 }, cylinder: { ...snapshot.cylinder, fill: 0 } };
  next[kind][key] = value;
  if (snapshot.linkedDimensions) next[kind === "cone" ? "cylinder" : "cone"][key] = value;
  return next;
}
export function matchCapacityDimensions(snapshot: SolidCapacitySnapshot): SolidCapacitySnapshot {
  return { ...snapshot, linkedDimensions: true, cone: { ...snapshot.cone, fill: 0 }, cylinder: { ...snapshot.cone, fill: 0 } };
}
export function equalBaseAndHeight(state: Pick<SolidCapacityInitial, "cone" | "cylinder">): boolean {
  return Math.abs(state.cone.radius - state.cylinder.radius) < 1e-10 && Math.abs(state.cone.height - state.cylinder.height) < 1e-10;
}
export function capacityCenters(state: Pick<SolidCapacityInitial, "cone" | "cylinder">): { cone: number; cylinder: number } {
  const gap = 1.4, extent = state.cone.radius + state.cylinder.radius + gap;
  return { cone: -extent / 2, cylinder: extent / 2 };
}

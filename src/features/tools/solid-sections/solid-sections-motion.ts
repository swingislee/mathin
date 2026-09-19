import type { SolidVector } from "../solid-geometry/solid-geometry-contract";
import { solidSectionNormal, sectionAdd, sectionDot, sectionPlaneBasis, sectionScale, sectionUnit } from "./solid-sections";
import type { SolidSectionSettings } from "./solid-sections-contract";

export const SOLID_SECTION_TRANSITION_MS = 360;
export interface SolidSectionFrame {
  normal: SolidVector;
  offset: number;
  planeOpacity: number;
  sectionOpacity: number;
  positiveOpacity: number;
  negativeOpacity: number;
}
export function solidSectionFrame(settings: SolidSectionSettings): SolidSectionFrame {
  return { normal: solidSectionNormal(settings), offset: settings.offset,
    planeOpacity: settings.enabled && settings.showPlane ? 0.12 : 0,
    sectionOpacity: settings.enabled ? 0.82 : 0,
    positiveOpacity: settings.enabled && settings.removedSide === "positive" ? 0 : 1,
    negativeOpacity: settings.enabled && settings.removedSide === "negative" ? 0 : 1 };
}
function mixDirection(from: SolidVector, to: SolidVector, t: number): SolidVector {
  const dot = Math.max(-1, Math.min(1, sectionDot(from, to)));
  if (dot > 0.9999) return sectionUnit(sectionAdd(sectionScale(from, 1 - t), sectionScale(to, t)));
  if (dot < -0.9999) return sectionAdd(sectionScale(from, Math.cos(Math.PI * t)), sectionScale(sectionPlaneBasis(from).u, Math.sin(Math.PI * t)));
  const angle = Math.acos(dot), denominator = Math.sin(angle);
  return sectionAdd(sectionScale(from, Math.sin((1 - t) * angle) / denominator), sectionScale(to, Math.sin(t * angle) / denominator));
}
export function interpolateSolidSection(from: SolidSectionFrame, to: SolidSectionFrame, progress: number): SolidSectionFrame {
  if (progress >= 1) return to;
  const t = 1 - (1 - Math.max(0, progress)) ** 3, mix = (a: number, b: number) => a + (b - a) * t;
  return { normal: mixDirection(from.normal, to.normal, t), offset: mix(from.offset, to.offset), planeOpacity: mix(from.planeOpacity, to.planeOpacity),
    sectionOpacity: mix(from.sectionOpacity, to.sectionOpacity), positiveOpacity: mix(from.positiveOpacity, to.positiveOpacity), negativeOpacity: mix(from.negativeOpacity, to.negativeOpacity) };
}
export function solidSectionVisible(frame: SolidSectionFrame): boolean {
  return frame.sectionOpacity > 0.001 || frame.planeOpacity > 0.001 || frame.positiveOpacity < 0.999 || frame.negativeOpacity < 0.999;
}

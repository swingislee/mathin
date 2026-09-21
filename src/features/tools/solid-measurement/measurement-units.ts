import type { SolidEntity, SolidVector } from "../solid-geometry/solid-geometry-contract";
import type { AnyMeasurementSettings, MeasurementUnit, MeasurementV2Settings } from "./measurement-v2-contract";

const millimetres = { mm: 1, cm: 10, dm: 100, m: 1000 } as const;
export function convertMeasurement(value: number, from: MeasurementUnit, to: MeasurementUnit, exponent: 1 | 2 | 3): number {
  if (!Number.isFinite(value)) throw new Error("A measurement must be finite");
  if (from === to) return value;
  if (from === "unit" || to === "unit") throw new Error("Assign a metric model scale before converting abstract units");
  return value * (millimetres[from] / millimetres[to]) ** exponent;
}
export function formatModelMeasurement(value: number, locale: string, exponent: 1 | 2 | 3, settings: AnyMeasurementSettings): string {
  const to = "version" in settings ? settings.displayUnit : "unit", from = settings.unit;
  const converted = convertMeasurement(value, from, to, exponent);
  const formatted = new Intl.NumberFormat(locale === "en" ? "en" : "zh", { maximumSignificantDigits: 7 }).format(converted);
  const numeric = Number(converted.toPrecision(7));
  return `${Math.abs(numeric - converted) > Math.abs(converted) * 1e-8 ? "≈ " : ""}${formatted} ${to === "unit" ? "u" : to}${exponent === 1 ? "" : exponent === 2 ? "²" : "³"}`;
}
export function accumulationSupport(entity: SolidEntity | null, mode: MeasurementV2Settings["accumulation"]): { available: true; total: number } | { available: false; reason: "cuboid" | "integer" } {
  if (!entity || (entity.kind !== "cube" && entity.kind !== "cuboid")) return { available: false, reason: "cuboid" };
  const d = entity.dimensions;
  if (![d.width, d.height, d.depth].every((n) => Number.isInteger(n) && n >= 1 && n <= 12)) return { available: false, reason: "integer" };
  return { available: true, total: mode === "none" ? 0 : mode === "length" ? d.width : mode === "area" ? d.width * d.depth : d.width * d.depth * d.height };
}
export interface MeasurementAccumulationCell { center: SolidVector; size: SolidVector; layer: number }
export function accumulationCells(entity: SolidEntity, mode: MeasurementV2Settings["accumulation"]): MeasurementAccumulationCell[] {
  const support = accumulationSupport(entity, mode); if (!support.available) return [];
  const { width: w, height: h, depth: d } = entity.dimensions;
  return Array.from({ length: support.total }, (_, index) => {
    const x = index % w, z = mode === "length" ? 0 : Math.floor(index / w) % d, y = mode === "volume" ? Math.floor(index / (w * d)) : 0;
    return { center: { x: x + 0.5 - w / 2, y: mode === "volume" ? y + 0.5 - h / 2 : -h / 2 + 0.018, z: mode === "length" ? -d / 2 : z + 0.5 - d / 2 },
      size: { x: 1, y: mode === "volume" ? 1 : 0.035, z: mode === "length" ? 0.055 : 1 }, layer: y };
  });
}
export function measurementConversionIdentity(unit: Exclude<MeasurementUnit, "unit" | "mm">, exponent: 1 | 2 | 3): { from: MeasurementUnit; to: MeasurementUnit; factor: number } {
  const to = unit === "m" ? "dm" : unit === "dm" ? "cm" : "mm";
  return { from: unit, to, factor: convertMeasurement(1, unit, to, exponent) };
}

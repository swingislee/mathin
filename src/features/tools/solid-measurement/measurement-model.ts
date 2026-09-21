import { buildRectangularPrismMeasurement } from "@/features/spatial-math/domain/rectangular-prism-measurement";
import { RECTANGULAR_PRISM_MEASUREMENT_LIMITS, type RectangularPrismDimensions } from "@/features/spatial-math/domain/rectangular-prism-measurement-schema";
import type { SolidEntity, SolidVector } from "../solid-geometry/solid-geometry-contract";
import { getSolidMetrics, getSolidTopology } from "../solid-geometry/solid-geometry";
import type { AnyMeasurementSettings as MeasurementSettings } from "./measurement-v2-contract";
import { formatModelMeasurement } from "./measurement-units";

export type MeasurementFillUnavailable = "select-solid" | "cuboid-only" | "whole-units" | "unit-limit";
type MeasurementShape = Pick<SolidEntity, "kind" | "dimensions">;
export type MeasurementFillAvailability = { available: true; dimensions: RectangularPrismDimensions; total: number; perLayer: number; layers: number }
  | { available: false; reason: MeasurementFillUnavailable };

/** 与历史测量内核共享上限和坐标映射；不将小数边或超限形状近似成满格。 */
export function measurementUnitFillAvailability(entity: MeasurementShape | null): MeasurementFillAvailability {
  if (!entity) return { available: false, reason: "select-solid" };
  if (entity.kind !== "cube" && entity.kind !== "cuboid") return { available: false, reason: "cuboid-only" };
  const { width: length, depth: width, height } = entity.dimensions;
  if (![length, width, height].every((n) => Number.isInteger(n) && n >= 1)) return { available: false, reason: "whole-units" };
  if ([length, width, height].some((n) => n > RECTANGULAR_PRISM_MEASUREMENT_LIMITS.maxDimension)) return { available: false, reason: "unit-limit" };
  return { available: true, dimensions: { length, width, height }, total: length * width * height, perLayer: length * width, layers: height };
}

export interface MeasurementUnitCell { id: string; center: SolidVector; layer: number }

export function buildMeasurementUnitCells(entity: MeasurementShape): MeasurementUnitCell[] {
  const support = measurementUnitFillAvailability(entity);
  if (!support.available) return [];
  const model = buildRectangularPrismMeasurement({ dimensions: support.dimensions, unit: "unit" });
  const { length, width, height } = model.dimensions;
  return model.occupiedCells.map((cell) => ({ id: `${cell.x}:${cell.y}:${cell.z}`, layer: cell.y,
    center: { x: cell.x + 0.5 - length / 2, y: cell.y + 0.5 - height / 2, z: cell.z + 0.5 - width / 2 } }));
}

export function measurementTargetLayers(entity: SolidEntity | null, settings: MeasurementSettings): number {
  const support = measurementUnitFillAvailability(entity);
  return settings.enabled && settings.unitFill && support.available ? Math.min(settings.fillLayers, support.layers) : 0;
}

/** 仅用于展示的壳体透明度。教师保存的材质/透明度以及数学实体保持原样。 */
export function measurementDisplayEntity(entity: SolidEntity, settings: MeasurementSettings): SolidEntity {
  return settings.enabled && ((settings.unitFill && measurementUnitFillAvailability(entity).available) || ("accumulation" in settings && settings.accumulation !== "none"))
    ? { ...entity, opacity: Math.min(entity.opacity, 0.1) } : entity;
}

/** 平面用三角剖分的面积，圆面/曲面直接读实体解析量，不数曲面渲染三角形。 */
export function measurementFaceArea(entity: SolidEntity, faceId: string): number | null {
  const face = getSolidTopology(entity).faces.find((item) => item.id === faceId);
  if (!face) return null;
  const metrics = getSolidMetrics(entity);
  if (entity.kind === "sphere") return metrics.surfaceArea;
  if (entity.kind === "cylinder" || entity.kind === "cone") {
    return face.surface === "plane" ? metrics.baseArea : metrics.surfaceArea - metrics.baseArea * (entity.kind === "cylinder" ? 2 : 1);
  }
  const origin = face.vertices[0];
  let area = 0;
  for (let i = 1; i < face.vertices.length - 1; i++) {
    const p = face.vertices[i], q = face.vertices[i + 1];
    const a = { x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z }, b = { x: q.x - origin.x, y: q.y - origin.y, z: q.z - origin.z };
    area += Math.hypot(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x) / 2;
  }
  return area;
}

export type MeasurementDimensionId = "width" | "height" | "depth" | "radius" | "baseWidth" | "triangleHeight" | "prismLength";
export interface MeasurementDimensionLine {
  id: MeasurementDimensionId; value: number; start: SolidVector; end: SolidVector;
  startAnchor: SolidVector; endAnchor: SolidVector; label: SolidVector;
}
const point = (x: number, y: number, z: number): SolidVector => ({ x, y, z });
function dimensionLine(id: MeasurementDimensionId, value: number, start: SolidVector, end: SolidVector, startAnchor: SolidVector, endAnchor: SolidVector): MeasurementDimensionLine {
  return { id, value, start, end, startAnchor, endAnchor, label: point((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2) };
}

/** 标注位于实体局部空间，随同一展示帧移动/转动；与主相机无第二套坐标。 */
export function measurementDimensionLines(entity: SolidEntity): MeasurementDimensionLine[] {
  const { width: w, height: h, depth: d, radius: r } = entity.dimensions, gap = 0.32;
  if (entity.kind === "sphere") return [dimensionLine("radius", r, point(0, 0, r + gap), point(r, 0, r + gap), point(0, 0, 0), point(r, 0, 0))];
  if (entity.kind === "cylinder" || entity.kind === "cone") return [
    dimensionLine("radius", r, point(0, -h / 2 - gap, 0), point(r, -h / 2 - gap, 0), point(0, -h / 2, 0), point(r, -h / 2, 0)),
    dimensionLine("height", h, point(r + gap, -h / 2, 0), point(r + gap, h / 2, 0), point(0, -h / 2, 0), point(0, h / 2, 0)),
  ];
  const triangular = entity.kind === "triangular-prism", pyramid = entity.kind === "square-pyramid";
  const lines = [
    dimensionLine(triangular || pyramid ? "baseWidth" : "width", w, point(-w / 2, -h / 2 - gap, d / 2), point(w / 2, -h / 2 - gap, d / 2), point(-w / 2, -h / 2, d / 2), point(w / 2, -h / 2, d / 2)),
    dimensionLine(triangular ? "triangleHeight" : "height", h, point(w / 2 + gap, -h / 2, d / 2), point(w / 2 + gap, h / 2, d / 2),
      point(triangular || pyramid ? 0 : w / 2, -h / 2, pyramid ? 0 : d / 2), point(triangular || pyramid ? 0 : w / 2, h / 2, pyramid ? 0 : d / 2)),
  ];
  if (!pyramid) lines.push(dimensionLine(triangular ? "prismLength" : "depth", d, point(-w / 2 - gap, -h / 2, -d / 2), point(-w / 2 - gap, -h / 2, d / 2), point(-w / 2, -h / 2, -d / 2), point(-w / 2, -h / 2, d / 2)));
  return lines;
}

export type MeasurementSegment = [SolidVector, SolidVector];
/** 表面每隔 1 u 画线；末格可不足 1 u，线的位置不会把小数尺寸改成整数。 */
export function measurementUnitGrid(entity: SolidEntity): MeasurementSegment[] {
  if (entity.kind !== "cube" && entity.kind !== "cuboid") return [];
  const { width: w, height: h, depth: d } = entity.dimensions, e = 0.008, lines: MeasurementSegment[] = [];
  for (let x = 1; x < w - 1e-8; x++) for (const sign of [-1, 1]) {
    lines.push([point(x - w / 2, -h / 2, sign * (d / 2 + e)), point(x - w / 2, h / 2, sign * (d / 2 + e))]);
    lines.push([point(x - w / 2, sign * (h / 2 + e), -d / 2), point(x - w / 2, sign * (h / 2 + e), d / 2)]);
  }
  for (let y = 1; y < h - 1e-8; y++) for (const sign of [-1, 1]) {
    lines.push([point(-w / 2, y - h / 2, sign * (d / 2 + e)), point(w / 2, y - h / 2, sign * (d / 2 + e))]);
    lines.push([point(sign * (w / 2 + e), y - h / 2, -d / 2), point(sign * (w / 2 + e), y - h / 2, d / 2)]);
  }
  for (let z = 1; z < d - 1e-8; z++) for (const sign of [-1, 1]) {
    lines.push([point(-w / 2, sign * (h / 2 + e), z - d / 2), point(w / 2, sign * (h / 2 + e), z - d / 2)]);
    lines.push([point(sign * (w / 2 + e), -h / 2, z - d / 2), point(sign * (w / 2 + e), h / 2, z - d / 2)]);
  }
  return lines;
}

export function formatMeasurementValue(value: number, locale: string, exponent: 1 | 2 | 3 = 1, settings?: MeasurementSettings): string {
  if (settings && "version" in settings) return formatModelMeasurement(value, locale, exponent, settings);
  const rounded = Math.round(value * 1000) / 1000;
  const approximate = Math.abs(value - rounded) > 1e-8;
  return `${approximate ? "≈ " : ""}${new Intl.NumberFormat(locale === "en" ? "en" : "zh", { maximumFractionDigits: 3 }).format(rounded)} u${exponent === 1 ? "" : exponent === 2 ? "²" : "³"}`;
}

export function formatMeasurementEquation(symbol: "S" | "V", value: number, locale: string, exponent: 2 | 3, settings?: MeasurementSettings): string {
  const formatted = formatMeasurementValue(value, locale, exponent, settings);
  return `${symbol} ${formatted.startsWith("≈") ? formatted : `= ${formatted}`}`;
}

export function measurementLayerFrame(from: number, to: number, elapsed: number, durationPerLayer: number): number {
  if (from === to) return to;
  const distance = Math.abs(to - from), progress = Math.max(0, Math.min(distance, elapsed / durationPerLayer));
  const whole = Math.floor(progress), fraction = progress - whole;
  const eased = fraction * fraction * (3 - 2 * fraction);
  return from + Math.sign(to - from) * Math.min(distance, whole + eased);
}

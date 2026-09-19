import { z } from "zod";
import { RECTANGULAR_PRISM_MEASUREMENT_LIMITS } from "@/features/spatial-math/domain/rectangular-prism-measurement-schema";

/** 抽象单位用于比较；不把屏幕长度解释成厘米等真实测量。 */
export const measurementSettingsSchema = z.object({
  enabled: z.boolean(),
  dimensions: z.boolean(),
  faceArea: z.boolean(),
  totals: z.boolean(),
  unitGrid: z.boolean(),
  unitFill: z.boolean(),
  fillLayers: z.number().int().min(0).max(RECTANGULAR_PRISM_MEASUREMENT_LIMITS.maxDimension),
  unit: z.literal("unit"),
}).strict();

export type MeasurementSettings = z.infer<typeof measurementSettingsSchema>;

export function createMeasurementSettings(): MeasurementSettings {
  return { enabled: false, dimensions: true, faceArea: true, totals: true, unitGrid: false, unitFill: false, fillLayers: 0, unit: "unit" };
}

/** 逐层演示是教学动作；只保存层数终点，动画帧不进入课堂状态。 */
export const MEASUREMENT_LAYER_MS = 480;

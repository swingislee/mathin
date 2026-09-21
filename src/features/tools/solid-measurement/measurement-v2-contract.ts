import { z } from "zod";
import { createMeasurementSettings, measurementSettingsSchema, type MeasurementSettings } from "./measurement-contract";

export const MEASUREMENT_VERSION = "solid-measurement-v2" as const;
export const MEASUREMENT_UNITS = ["unit", "mm", "cm", "dm", "m"] as const;
export type MeasurementUnit = typeof MEASUREMENT_UNITS[number];
export const measurementV2SettingsSchema = measurementSettingsSchema.extend({
  version: z.literal(MEASUREMENT_VERSION), unit: z.enum(MEASUREMENT_UNITS),
  displayUnit: z.enum(MEASUREMENT_UNITS),
  accumulation: z.enum(["none", "length", "area", "volume"]),
  accumulationCount: z.number().int().min(0).max(1728),
}).strict().superRefine((value, ctx) => {
  if ((value.unit === "unit") !== (value.displayUnit === "unit")) ctx.addIssue({ code: "custom", path: ["displayUnit"], message: "Abstract units cannot be converted to metric units without assigning a scale" });
});
export type MeasurementV2Settings = z.infer<typeof measurementV2SettingsSchema>;
export type AnyMeasurementSettings = MeasurementSettings | MeasurementV2Settings;
export function createMeasurementV2Settings(): MeasurementV2Settings {
  return { ...createMeasurementSettings(), version: MEASUREMENT_VERSION, unit: "cm", displayUnit: "cm", accumulation: "none", accumulationCount: 0 };
}
export function upgradeMeasurementSettings(settings: MeasurementSettings): MeasurementV2Settings {
  return { ...settings, version: MEASUREMENT_VERSION, displayUnit: "unit", accumulation: "none", accumulationCount: 0 };
}

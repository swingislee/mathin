import { z } from "zod";

export const SOLID_CAPACITY_VERSION = "solid-capacity-lesson-v1" as const;
export const CAPACITY_DIMENSIONS = { min: 0.25, max: 6 } as const;
const dimension = z.number().finite().min(CAPACITY_DIMENSIONS.min).max(CAPACITY_DIMENSIONS.max);
/** fill 是液量 / 总容量，不是液面高度比例。 */
export const capacityVesselSchema = z.object({ radius: dimension, height: dimension, fill: z.number().finite().min(0).max(1) }).strict();
export type CapacityVessel = z.infer<typeof capacityVesselSchema>;
export type CapacityVesselKind = "cone" | "cylinder";
export type ConeOrientation = "tip-down" | "tip-up";
const fields = {
  cone: capacityVesselSchema, cylinder: capacityVesselSchema,
  coneOrientation: z.enum(["tip-down", "tip-up"]), linkedDimensions: z.boolean(),
  showAmounts: z.boolean(), showDimensions: z.boolean(), axes: z.boolean(), grid: z.boolean(),
  view: z.enum(["angle", "front", "left", "right", "top", "bottom"]),
};
function checkLinked(state: { linkedDimensions: boolean; cone: CapacityVessel; cylinder: CapacityVessel }, ctx: z.RefinementCtx) {
  if (state.linkedDimensions && (state.cone.radius !== state.cylinder.radius || state.cone.height !== state.cylinder.height)) {
    ctx.addIssue({ code: "custom", message: "Linked vessels must have equal radii and heights", path: ["linkedDimensions"] });
  }
}
export const solidCapacityInitialSchema = z.object(fields).strict().superRefine(checkLinked);
export type SolidCapacityInitial = z.infer<typeof solidCapacityInitialSchema>;
export const solidCapacitySnapshotSchema = z.object({ ...fields, cameraRevision: z.number().int().min(0).max(1_000_000) }).strict().superRefine(checkLinked);
export type SolidCapacitySnapshot = z.infer<typeof solidCapacitySnapshotSchema>;
export const solidCapacityToolSchema = z.object({
  toolId: z.literal("solid-capacity"), contentVersion: z.literal(SOLID_CAPACITY_VERSION),
  payload: z.object({ title: z.string().trim().min(1).max(80), initial: solidCapacityInitialSchema }).strict(),
}).strict();
export type SolidCapacityToolScene = z.infer<typeof solidCapacityToolSchema>;
export function createDefaultSolidCapacityInitial(): SolidCapacityInitial {
  return { cone: { radius: 1, height: 3, fill: 1 }, cylinder: { radius: 1, height: 3, fill: 0 },
    coneOrientation: "tip-down", linkedDimensions: true, showAmounts: false, showDimensions: true, axes: false, grid: false, view: "angle" };
}
export function solidCapacitySnapshot(initial: SolidCapacityInitial): SolidCapacitySnapshot {
  return { ...solidCapacityInitialSchema.parse(structuredClone(initial)), cameraRevision: 0 };
}
export function solidCapacityInitial(snapshot: SolidCapacitySnapshot): SolidCapacityInitial {
  return solidCapacityInitialSchema.parse({ cone: snapshot.cone, cylinder: snapshot.cylinder, coneOrientation: snapshot.coneOrientation,
    linkedDimensions: snapshot.linkedDimensions, showAmounts: snapshot.showAmounts, showDimensions: snapshot.showDimensions,
    axes: snapshot.axes, grid: snapshot.grid, view: snapshot.view });
}

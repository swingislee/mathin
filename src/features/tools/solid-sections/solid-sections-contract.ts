import { z } from "zod";
import type { SolidKind } from "../solid-geometry/solid-geometry-contract";

export const SOLID_SECTION_KINDS = ["cube", "cuboid", "triangular-prism", "square-pyramid"] as const;
export const solidSectionSettingsSchema = z.object({
  enabled: z.boolean(),
  axis: z.enum(["x", "y", "z"]),
  offset: z.number().finite().min(-1.2).max(1.2),
  tiltA: z.number().finite().min(-90).max(90),
  tiltB: z.number().finite().min(-90).max(90),
  removedSide: z.enum(["none", "positive", "negative"]),
  showPlane: z.boolean(),
}).strict();
export type SolidSectionSettings = z.infer<typeof solidSectionSettingsSchema>;
export function createSolidSectionSettings(): SolidSectionSettings {
  return { enabled: false, axis: "y", offset: 0, tiltA: 0, tiltB: 0, removedSide: "none", showPlane: true };
}
export function supportsSolidSection(kind: SolidKind): boolean {
  return (SOLID_SECTION_KINDS as readonly string[]).includes(kind);
}

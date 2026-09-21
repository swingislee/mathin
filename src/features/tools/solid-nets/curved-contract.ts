import { z } from "zod";
import { CUBE_COLORS } from "../spatial-lab/cube-structures-contract";
import { createDefaultSolidNetsPolyhedraSnapshot, solidNetsPolyhedraSnapshotSchema } from "./contract";

export const SOLID_NETS_COMPLETE_VERSION = "solid-nets-lesson-v3" as const;
export const curvedProgressSchema = z.object({ side: z.number().finite().min(0).max(1), lower: z.number().finite().min(0).max(1), upper: z.number().finite().min(0).max(1) }).strict();
const surface = z.object({ color: z.enum(CUBE_COLORS), opacity: z.number().finite().min(0).max(1) }).strict();
export const curvedNetSnapshotSchema = z.object({
  version: z.literal("curved-net-v1"), kind: z.enum(["cylinder", "cone"]),
  radius: z.number().finite().min(0.25).max(4), height: z.number().finite().min(0.25).max(8),
  progress: curvedProgressSchema,
  surfaces: z.object({ side: surface, lower: surface, upper: surface }).strict(),
  labelsVisible: z.boolean(), view: z.enum(["angle", "front", "left", "right", "top"]),
  motion: z.object({ id: z.string().uuid(), from: curvedProgressSchema, startedAt: z.number().int().min(0).max(8e15), durationMs: z.number().int().min(300).max(12000) }).strict().nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.kind === "cone" && (value.progress.upper !== 0 || (value.motion && value.motion.from.upper !== 0))) ctx.addIssue({ code: "custom", message: "CONE_HAS_ONE_BASE" });
});
export type CurvedNetSnapshot = z.infer<typeof curvedNetSnapshotSchema>;
export type CurvedProgress = z.infer<typeof curvedProgressSchema>;
export type CurvedPart = keyof CurvedProgress;
export const solidNetsCompleteSnapshotSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("polyhedron"), data: solidNetsPolyhedraSnapshotSchema }).strict(),
  z.object({ mode: z.literal("curved"), data: curvedNetSnapshotSchema }).strict(),
]);
export type SolidNetsCompleteSnapshot = z.infer<typeof solidNetsCompleteSnapshotSchema>;
export const solidNetsCompleteInitialSchema = solidNetsCompleteSnapshotSchema.refine((value) => value.mode !== "curved" || value.data.motion === null, "SAVE_STABLE_CURVED_NET");
export const solidNetsCompleteToolSchema = z.object({ toolId: z.literal("solid-nets"), contentVersion: z.literal(SOLID_NETS_COMPLETE_VERSION),
  payload: z.object({ title: z.string().trim().min(1).max(80), initial: solidNetsCompleteInitialSchema }).strict(),
}).strict();
export function createCurvedNet(kind: CurvedNetSnapshot["kind"] = "cylinder"): CurvedNetSnapshot {
  return curvedNetSnapshotSchema.parse({ version: "curved-net-v1", kind, radius: 1, height: 2.5,
    progress: { side: 0, lower: 0, upper: 0 }, surfaces: { side: { color: CUBE_COLORS[5], opacity: 0.9 }, lower: { color: CUBE_COLORS[1], opacity: 0.9 }, upper: { color: CUBE_COLORS[2], opacity: 0.9 } },
    labelsVisible: true, view: "angle", motion: null });
}
export function createDefaultSolidNetsComplete(): SolidNetsCompleteSnapshot { return { mode: "polyhedron", data: createDefaultSolidNetsPolyhedraSnapshot() }; }

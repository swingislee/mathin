import { z } from "zod";
import { createDefaultSolidCapacityInitial, solidCapacityInitial, solidCapacityInitialSchema, solidCapacitySnapshot, solidCapacitySnapshotSchema } from "./solid-capacity-contract";
import { createDefaultDisplacementInitial, displacementInitial, displacementInitialSchema, displacementSnapshot, displacementSnapshotSchema } from "./displacement-contract";

export const SOLID_CAPACITY_TEACHING_VERSION = "solid-capacity-lesson-v2" as const;
export const solidCapacityTeachingInitialSchema = z.object({ mode: z.enum(["pour", "displacement"]), pour: solidCapacityInitialSchema, displacement: displacementInitialSchema }).strict();
export const solidCapacityTeachingSnapshotSchema = z.object({ mode: z.enum(["pour", "displacement"]), pour: solidCapacitySnapshotSchema, displacement: displacementSnapshotSchema }).strict();
export type SolidCapacityTeachingInitial = z.infer<typeof solidCapacityTeachingInitialSchema>;
export type SolidCapacityTeachingSnapshot = z.infer<typeof solidCapacityTeachingSnapshotSchema>;
export const solidCapacityTeachingToolSchema = z.object({ toolId: z.literal("solid-capacity"), contentVersion: z.literal(SOLID_CAPACITY_TEACHING_VERSION),
  payload: z.object({ title: z.string().trim().min(1).max(80), initial: solidCapacityTeachingInitialSchema }).strict(),
}).strict();
export function createDefaultSolidCapacityTeachingInitial(): SolidCapacityTeachingInitial {
  return { mode: "pour", pour: createDefaultSolidCapacityInitial(), displacement: createDefaultDisplacementInitial() };
}
export function solidCapacityTeachingSnapshot(initial: SolidCapacityTeachingInitial): SolidCapacityTeachingSnapshot {
  return { mode: initial.mode, pour: solidCapacitySnapshot(initial.pour), displacement: displacementSnapshot(initial.displacement) };
}
export function solidCapacityTeachingInitial(snapshot: SolidCapacityTeachingSnapshot): SolidCapacityTeachingInitial {
  return solidCapacityTeachingInitialSchema.parse({ mode: snapshot.mode, pour: solidCapacityInitial(snapshot.pour), displacement: displacementInitial(snapshot.displacement) });
}

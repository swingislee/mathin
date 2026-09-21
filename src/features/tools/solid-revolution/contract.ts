import { z } from "zod";

export const SOLID_REVOLUTION_VERSION = "solid-revolution-lesson-v1" as const;
export const SOLID_REVOLUTION_SHAPES = ["rectangle", "right-triangle"] as const;
export const SOLID_REVOLUTION_SPEEDS = [15, 30, 60] as const;
const angle = z.number().finite().min(0).max(360);
const dimension = z.number().finite().min(0.5).max(6);
const fields = {
  shape: z.enum(SOLID_REVOLUTION_SHAPES), axis: z.enum(["height", "width"]), width: dimension, height: dimension,
  angle, speed: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  showSweep: z.boolean(), showStart: z.boolean(), showMeasures: z.boolean(), axes: z.boolean(), grid: z.boolean(),
  view: z.enum(["angle", "front", "left", "right", "top", "bottom"]),
};
export const solidRevolutionInitialSchema = z.object(fields).strict();
export type SolidRevolutionInitial = z.infer<typeof solidRevolutionInitialSchema>;
/** 只保存教学命令的起点与终点；中间帧由各端根据同一时刻还原。 */
export const revolutionMotionSchema = z.object({
  id: z.string().uuid(), fromAngle: angle, toAngle: angle,
  startedAt: z.number().int().min(0).max(10_000_000_000_000), durationMs: z.number().finite().min(1).max(60_000),
}).strict().refine((motion) => motion.fromAngle !== motion.toAngle);
export type RevolutionMotion = z.infer<typeof revolutionMotionSchema>;
export const solidRevolutionSnapshotSchema = z.object({ ...fields,
  cameraRevision: z.number().int().min(0).max(1_000_000), motion: revolutionMotionSchema.nullable(),
}).strict().superRefine((snapshot, ctx) => {
  if (snapshot.motion && snapshot.motion.toAngle !== snapshot.angle) ctx.addIssue({ code: "custom", path: ["angle"], message: "Motion must end at the authoritative angle" });
});
export type SolidRevolutionSnapshot = z.infer<typeof solidRevolutionSnapshotSchema>;
export const solidRevolutionToolSchema = z.object({
  toolId: z.literal("solid-revolution"), contentVersion: z.literal(SOLID_REVOLUTION_VERSION),
  payload: z.object({ title: z.string().trim().min(1).max(80), initial: solidRevolutionInitialSchema }).strict(),
}).strict();
export type SolidRevolutionToolScene = z.infer<typeof solidRevolutionToolSchema>;
export function createDefaultSolidRevolutionInitial(): SolidRevolutionInitial {
  return { shape: "rectangle", axis: "height", width: 2, height: 3, angle: 0, speed: 30,
    showSweep: true, showStart: true, showMeasures: true, axes: false, grid: true, view: "angle" };
}
export function solidRevolutionSnapshot(initial: SolidRevolutionInitial): SolidRevolutionSnapshot {
  return { ...solidRevolutionInitialSchema.parse(structuredClone(initial)), cameraRevision: 0, motion: null };
}
export function solidRevolutionInitial(snapshot: SolidRevolutionSnapshot): SolidRevolutionInitial {
  return solidRevolutionInitialSchema.parse({ shape: snapshot.shape, axis: snapshot.axis, width: snapshot.width, height: snapshot.height,
    angle: snapshot.angle, speed: snapshot.speed, showSweep: snapshot.showSweep, showStart: snapshot.showStart, showMeasures: snapshot.showMeasures,
    axes: snapshot.axes, grid: snapshot.grid, view: snapshot.view });
}

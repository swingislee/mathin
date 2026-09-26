import { z } from "zod";
import { isValidPlaneGeometryState } from "../plane-geometry/validation";
import { isValidPlaneAreaState } from "../plane-area/validation";
import { isValidPlaneMotionState } from "../plane-motion/validation";
import { isValidPlanePatternsState } from "../plane-patterns/validation";
import { isValidPlaneShapesState } from "../plane-shapes/validation";

import { ALL_PLANAR_TOOLS, type PlanarToolId, type PlanarVersion } from "./catalog";
export { PLANAR_TOOLS, ALL_PLANAR_TOOLS, type PlanarToolId, type PlanarVersion } from "./catalog";
export interface PlanarPoint { x: number; y: number }
const key = z.string().regex(/^[a-zA-Z0-9_.-]{1,64}$/).refine((value) => !["__proto__", "constructor", "prototype"].includes(value));
const finite = z.number().finite().min(-100_000).max(100_000);
const bounded = <T extends z.ZodTypeAny>(value: T) => z.record(key, value).refine((record) => Object.keys(record).length <= 256, "TOO_MANY_PARAMETERS");
const planarStateShape = z.object({
  sceneId: z.enum([...new Set(ALL_PLANAR_TOOLS.flatMap((tool) => [...tool.scenes]))] as [string, ...string[]]),
  params: bounded(finite),
  points: bounded(z.object({ x: finite, y: finite }).strict()),
  flags: bounded(z.boolean()),
  marks: z.array(key).max(512),
  phase: z.number().finite().min(0).max(1),
}).strict();
export type PlanarState = z.infer<typeof planarStateShape>;
export const planarStateSchema = planarStateShape.refine((state) => isValidPlaneGeometryState(state) || isValidPlaneAreaState(state) || isValidPlaneMotionState(state) || isValidPlanePatternsState(state) || isValidPlaneShapesState(state), "INVALID_PLANAR_GEOMETRY");
export function emptyPlanarState(sceneId: string): PlanarState {
  return { sceneId, params: {}, points: {}, flags: { grid: false, measures: true }, marks: [], phase: 0 };
}
export function stateBelongsToTool(toolId: PlanarToolId, state: PlanarState) {
  return (ALL_PLANAR_TOOLS.find((tool) => tool.id === toolId)!.scenes as readonly string[]).includes(state.sceneId);
}
function toolSchema<I extends PlanarToolId, V extends PlanarVersion>(toolId: I, version: V) {
  return z.object({ toolId: z.literal(toolId), contentVersion: z.literal(version), payload: z.object({
    title: z.string().trim().min(1).max(80), initial: planarStateSchema.refine((state) => stateBelongsToTool(toolId, state), "SCENE_TOOL_MISMATCH"),
  }).strict() }).strict();
}
type PlanarSchemas<T extends readonly (typeof ALL_PLANAR_TOOLS)[number][]> = {
  [K in keyof T]: ReturnType<typeof toolSchema<T[K]["id"], T[K]["version"]>>
};
// 保留每个工具的字面版本类型；运行时与工具目录逐项对应，编辑器不维护另一份名单。
export const planarToolSchemas = ALL_PLANAR_TOOLS.map((tool) => toolSchema(tool.id, tool.version)) as unknown as PlanarSchemas<typeof ALL_PLANAR_TOOLS>;

export const planarMotionSchema = z.object({
  id: z.string().uuid(), actionId: key, from: planarStateShape, to: planarStateSchema,
  startedAt: z.number().int().min(0).max(10_000_000_000_000), durationMs: z.number().finite().min(1).max(60_000),
  progress: z.number().min(0).max(1), paused: z.boolean(),
}).strict().refine((motion) => motion.from.sceneId === motion.to.sceneId, "MOTION_SCENE_MISMATCH")
  .refine((motion) => {
    if (planarStateSchema.safeParse(motion.from).success) return true;
    if (motion.actionId !== "snap" || motion.durationMs > 500) return false;
    // 吸附的起点是已显示的自由拖动帧，可不在离散格点；只有点位能变化，终点仍执行完整领域校验。
    const from = { ...motion.from, points: undefined }, to = { ...motion.to, points: undefined };
    return JSON.stringify(from) === JSON.stringify(to)
      && Object.keys(motion.from.points).sort().join() === Object.keys(motion.to.points).sort().join()
      && Object.values(motion.from.points).every((point) => Math.abs(point.x) <= 5000 && Math.abs(point.y) <= 5000);
  }, "INVALID_MOTION_SOURCE");
export type PlanarMotion = z.infer<typeof planarMotionSchema>;
export const planarSnapshotSchema = z.object({
  current: planarStateSchema, past: z.array(planarStateSchema).max(12), future: z.array(planarStateSchema).max(12), motion: planarMotionSchema.nullable(),
}).strict().refine((snapshot) => !snapshot.motion || JSON.stringify(snapshot.motion.to) === JSON.stringify(snapshot.current), "MOTION_ENDPOINT_MISMATCH");
export type PlanarSnapshot = z.infer<typeof planarSnapshotSchema>;
export function planarSnapshot(initial: PlanarState): PlanarSnapshot {
  return { current: planarStateSchema.parse(structuredClone(initial)), past: [], future: [], motion: null };
}
export function planarSnapshotForTool(tool: PlanarToolId) {
  return planarSnapshotSchema.refine((snapshot) => [snapshot.current, ...snapshot.past, ...snapshot.future, ...(snapshot.motion ? [snapshot.motion.from, snapshot.motion.to] : [])].every((state) => stateBelongsToTool(tool, state)), "SNAPSHOT_TOOL_MISMATCH");
}

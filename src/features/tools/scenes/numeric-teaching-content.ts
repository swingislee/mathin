import { z } from "zod";
import { DEFAULT_HEAD, DEFAULT_VEHICLE, MAX_RUNWAYS, VEHICLES } from "../motion-lab/shared";

export const FRACTION_COURSEWARE_VERSION = "fraction-line-lesson-v1" as const;
export const MOTION_COURSEWARE_VERSION = "motion-lab-lesson-v1" as const;
export const FRACTION_COLORS = ["var(--rose)", "var(--leaf-deep)", "var(--ink)", "var(--crater)", "var(--rose-deep)", "var(--leaf)"] as const;
export const NUMERIC_SCENE_MAX_BYTES = 256_000;
export const fractionSceneSchema = z.object({
  rows: z.array(z.object({ denominator: z.number().int().min(1).max(10000), count: z.number().int().min(1).max(2000), color: z.enum(FRACTION_COLORS) }).strict()).max(32)
    .refine((rows) => rows.reduce((sum, row) => sum + row.count, 0) <= 2000),
  denomText: z.string().regex(/^\d{0,5}$/), zoomPow: z.number().min(1).max(Math.log10(1200000)),
  showTicks: z.boolean(), showGuides: z.boolean(), zeroX: z.number().min(-200000000).max(20000),
}).strict();
export type FractionScene = z.infer<typeof fractionSceneSchema>;
export function initialFractionScene(): FractionScene {
  return { rows: [], denomText: "2", zoomPow: Math.log10(120), showTicks: true, showGuides: true, zeroX: 56 };
}
const finiteAmount = z.number().min(0).max(1e9);
const image = z.string().max(128_000).refine((src) => [DEFAULT_HEAD, ...VEHICLES].includes(src)
  || /^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(src), "Only built-in or embedded raster images are supported");
export const motionSceneSchema = z.object({
  length: z.number().positive().max(1e9),
  runways: z.array(z.object({ id: z.number().int().positive().max(1e9), head: image, vehicle: image,
    facingRight: z.boolean(), x: finiteAmount, solve: z.enum(["distance", "time", "speed"]),
    distance: finiteAmount, time: finiteAmount, speed: finiteAmount }).strict()).min(1).max(MAX_RUNWAYS),
  showRuler: z.boolean(), allTime: finiteAmount, allSpeed: finiteAmount,
  playback: z.object({ phase: z.enum(["idle", "running", "paused"]), elapsedMs: finiteAmount,
    startedAt: z.number().int().nonnegative().max(8_640_000_000_000_000) }).strict(),
}).strict().refine((scene) => new Set(scene.runways.map((r) => r.id)).size === scene.runways.length && scene.runways.every((r) => r.x <= scene.length));
export type MotionScene = z.infer<typeof motionSceneSchema>;
export function initialMotionScene(): MotionScene {
  return { length: 100, runways: [{ id: 1, head: DEFAULT_HEAD, vehicle: DEFAULT_VEHICLE, facingRight: true, x: 0, solve: "speed", distance: 100, time: 10, speed: 10 }],
    showRuler: true, allTime: 10, allSpeed: 10, playback: { phase: "idle", elapsedMs: 0, startedAt: 0 } };
}
/** 时间只驱动呈现；传输保存播放起点和时刻，不发送每一帧位置。 */
export function motionFrame(scene: MotionScene, now: number) {
  const duration = Math.max(0, ...scene.runways.map((r) => r.speed > 0 ? r.time : 0));
  const elapsed = Math.max(0, scene.playback.elapsedMs + (scene.playback.phase === "running" ? now - scene.playback.startedAt : 0)) / 1000;
  const clock = Math.min(duration, elapsed);
  const phase = scene.playback.phase === "running" && elapsed >= duration ? "idle" : scene.playback.phase;
  const runways = scene.runways.map((r) => ({ ...r, x: Math.max(0, Math.min(scene.length, r.x + (r.facingRight ? 1 : -1) * r.speed * Math.min(clock, r.time))) }));
  return { clock, phase, runways };
}
const payload = <S extends z.ZodType>(initial: S) => z.object({ title: z.string().trim().min(1).max(80), initial }).strict();
const budget = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= NUMERIC_SCENE_MAX_BYTES;
export const fractionCoursewareSchema = z.object({ toolId: z.literal("fraction-line"), contentVersion: z.literal(FRACTION_COURSEWARE_VERSION), payload: payload(fractionSceneSchema) }).strict().refine(budget);
export const motionCoursewareSchema = z.object({ toolId: z.literal("motion-lab"), contentVersion: z.literal(MOTION_COURSEWARE_VERSION), payload: payload(motionSceneSchema.refine((s) => s.playback.phase === "idle" && s.playback.elapsedMs === 0 && s.playback.startedAt === 0)) }).strict().refine(budget);
export const numericTeachingToolSchema = z.discriminatedUnion("contentVersion", [fractionCoursewareSchema, motionCoursewareSchema]);
export type NumericTeachingTool = z.infer<typeof numericTeachingToolSchema>;
export function isNumericTeachingTool(tool: { contentVersion: string }): tool is NumericTeachingTool {
  return tool.contentVersion === FRACTION_COURSEWARE_VERSION || tool.contentVersion === MOTION_COURSEWARE_VERSION;
}

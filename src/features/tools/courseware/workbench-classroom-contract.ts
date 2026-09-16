import { z } from "zod";
import { cubeNetTeachingSnapshotSchema, diceSceneSchema, diceTeachingSnapshotSchema, NET_FACE_IDS } from "./spatial-teaching-content";

export const workbenchRevision = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const face = z.enum(["x+", "x-", "y+", "y-", "z+", "z-"]);
const diceId = diceTeachingSnapshotSchema.shape.selectedId;
const xray = z.object({ id: diceId, face }).strict().nullable();
export const diceLiveSnapshotSchema = diceTeachingSnapshotSchema.safeExtend({
  xrayTarget: xray,
  observation: z.object({ panel: z.enum(["opposite", "observe"]).nullable(), face, pair: face }).strict(),
}).refine((snapshot) => !snapshot.xrayTarget || snapshot.scene.dice.some((die) => die.id === snapshot.xrayTarget!.id));
export const netLiveSnapshotSchema = cubeNetTeachingSnapshotSchema.safeExtend({
  judgment: z.enum(["closed", "open", "intersection"]).nullable(), galleryOpen: z.boolean(),
});
export const diceTeachingCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tween"), target: diceSceneSchema, durationMs: z.number().int().min(1).max(2000) }).strict(),
  z.object({ kind: z.literal("roll"), id: diceId, direction: z.enum(["x+", "x-", "z+", "z-"]), trail: z.boolean() }).strict(),
  // 随机输入与落定结果由教师一次确定；轨迹是可丢表现，不存逐帧数据。
  z.object({ kind: z.literal("throw"), seed: z.number().int().min(0).max(0xffffffff), target: diceSceneSchema,
    durationMs: z.number().positive().max(13_000), settled: z.boolean() }).strict(),
  z.object({ kind: z.literal("xray"), target: xray }).strict(),
]);
export const netTeachingCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["unfold", "cut", "toggle-reveal", "restore-faces", "recenter"]) }).strict(),
  z.object({ kind: z.literal("move-face"), faceId: z.enum(NET_FACE_IDS) }).strict(),
  z.object({ kind: z.literal("unfold-cuts"), faceId: z.enum(NET_FACE_IDS).optional() }).strict(),
  z.object({ kind: z.literal("gallery"), entryId: cubeNetTeachingSnapshotSchema.shape.source.shape.entryId }).strict(),
  z.object({ kind: z.literal("fold"), edgeId: z.string().max(40), degrees: z.number().int().min(-90).max(90),
    anchor: cubeNetTeachingSnapshotSchema.shape.anchor }).strict(),
]);

/** 所有工作台共用的持久格式：稳定快照 + 可选的可重放语义动作。 */
export function workbenchStateSchema<S extends z.ZodType, C extends z.ZodType>(snapshot: S, command: C) {
  return z.object({ id: workbenchRevision, snapshot, settles: workbenchRevision.nullable(),
    motion: z.object({ command, startedAt: z.number().int().nonnegative().max(8_640_000_000_000_000) }).strict().nullable(),
  }).strict().refine((state) => !state.motion || state.settles === null, "Motion cannot also settle another motion");
}
export const diceWorkbenchStateSchema = workbenchStateSchema(diceLiveSnapshotSchema, diceTeachingCommandSchema).refine(({ snapshot, motion }) => {
  if (!motion) return true;
  const command = motion.command, dice = snapshot.scene.dice;
  if (command.kind === "roll") return dice.some((die) => die.id === command.id);
  if (command.kind === "xray") return !command.target || dice.some((die) => die.id === command.target!.id);
  return command.target.nextId === snapshot.scene.nextId && command.target.dice.length === dice.length
    && command.target.dice.every((die, index) => die.id === dice[index].id && die.hand === dice[index].hand);
}, "Motion must reference the same dice");
export const netWorkbenchStateSchema = workbenchStateSchema(netLiveSnapshotSchema, netTeachingCommandSchema).refine(({ snapshot, motion }) => {
  if (!motion) return true;
  const command = motion.command;
  if (command.kind === "fold") return !snapshot.cutting && Object.hasOwn(snapshot.angles, command.edgeId);
  if (command.kind === "gallery" || command.kind === "unfold") return !snapshot.cutting;
  if (["toggle-reveal", "move-face", "restore-faces", "unfold-cuts"].includes(command.kind)) return !!snapshot.cutting;
  return true;
}, "Motion must match the saved net mode and hinges");
export type DiceLiveSnapshot = z.infer<typeof diceLiveSnapshotSchema>;
export type NetLiveSnapshot = z.infer<typeof netLiveSnapshotSchema>;
export type DiceTeachingCommand = z.infer<typeof diceTeachingCommandSchema>;
export type NetTeachingCommand = z.infer<typeof netTeachingCommandSchema>;
export interface TeachingWorkbenchState<S, C> {
  readonly id: string; readonly snapshot: S; readonly settles: string | null;
  readonly motion: { readonly command: C; readonly startedAt: number } | null;
}
export interface TeachingWorkbenchPort<S, C> {
  readonly pending: boolean;
  readonly replay: TeachingWorkbenchState<S, C>["motion"];
  readonly capture: (snapshot: S | null, cameraRevision?: number) => void;
  readonly command: (command: C, execute: () => void | Promise<void>) => void;
  readonly reset: () => void;
  readonly cancel: () => void;
  readonly resetLabel?: string;
}

/** 可复现的模拟初始条件；不参与账号、会话或安全标识生成。 */
export function teachingRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ state >>> 15, state | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

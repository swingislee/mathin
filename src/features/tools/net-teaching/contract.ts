import { z } from "zod";
import { cubeNetTeachingSnapshotSchema } from "../courseware/spatial-teaching-content";
import { netWorkbenchStateSchema } from "../courseware/workbench-classroom-contract";
import { paperFoldingSnapshotSchema } from "../paper-folding/contract";
import { solidNetsSnapshotSchema } from "../solid-nets/contract";

export const NET_TEACHING_VERSION = "cube-net-lesson-v2" as const;
export const CUBE_NET_EXPLORATION_VERSION = "cube-net-lesson-v3" as const;
export const CUBE_NET_EXPLORATION_MODES = ["standard", "free-paper"] as const;
export const netTeachingInitialSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("standard"), data: cubeNetTeachingSnapshotSchema }).strict(),
  z.object({ mode: z.literal("free-paper"), data: paperFoldingSnapshotSchema }).strict(),
  z.object({ mode: z.literal("solid-net"), data: solidNetsSnapshotSchema }).strict(),
]);
export const netTeachingStateSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("standard"), data: netWorkbenchStateSchema }).strict(),
  z.object({ mode: z.literal("free-paper"), data: paperFoldingSnapshotSchema }).strict(),
  z.object({ mode: z.literal("solid-net"), data: solidNetsSnapshotSchema }).strict(),
]);
export const netTeachingToolSchema = z.object({ toolId: z.literal("spatial-lab"), contentVersion: z.literal(NET_TEACHING_VERSION),
  payload: z.object({ title: z.string().trim().min(1).max(80), initial: netTeachingInitialSchema }).strict(),
}).strict();
// 旧 v2 保留三种方式；新建正方体探究只保存正方体与自由拼纸。
export const cubeNetExplorationInitialSchema = z.discriminatedUnion("mode", [netTeachingInitialSchema.options[0], netTeachingInitialSchema.options[1]]);
export const cubeNetExplorationStateSchema = z.discriminatedUnion("mode", [netTeachingStateSchema.options[0], netTeachingStateSchema.options[1]]);
export const cubeNetExplorationToolSchema = netTeachingToolSchema.extend({
  contentVersion: z.literal(CUBE_NET_EXPLORATION_VERSION),
  payload: z.object({ title: z.string().trim().min(1).max(80), initial: cubeNetExplorationInitialSchema }).strict(),
});
export type CubeNetExplorationInitial = z.infer<typeof cubeNetExplorationInitialSchema>;
export type CubeNetExplorationState = z.infer<typeof cubeNetExplorationStateSchema>;
export type NetTeachingInitial = z.infer<typeof netTeachingInitialSchema>;
export type NetTeachingState = z.infer<typeof netTeachingStateSchema>;
export type NetTeachingMode = NetTeachingInitial["mode"];
export function netInitialState(initial: NetTeachingInitial): NetTeachingState {
  return initial.mode === "standard" ? { mode: "standard", data: {
    id: "origin", snapshot: { ...initial.data, judgment: null, galleryOpen: false }, settles: null, motion: null,
  } } : initial;
}

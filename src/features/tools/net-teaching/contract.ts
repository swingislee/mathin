import { z } from "zod";
import { cubeNetTeachingSnapshotSchema } from "../courseware/spatial-teaching-content";
import { netWorkbenchStateSchema } from "../courseware/workbench-classroom-contract";
import { paperFoldingSnapshotSchema } from "../paper-folding/contract";
import { solidNetsSnapshotSchema } from "../solid-nets/contract";

export const NET_TEACHING_VERSION = "cube-net-lesson-v2" as const;
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
export type NetTeachingInitial = z.infer<typeof netTeachingInitialSchema>;
export type NetTeachingState = z.infer<typeof netTeachingStateSchema>;
export type NetTeachingMode = NetTeachingInitial["mode"];
export function netInitialState(initial: NetTeachingInitial): NetTeachingState {
  return initial.mode === "standard" ? { mode: "standard", data: {
    id: "origin", snapshot: { ...initial.data, judgment: null, galleryOpen: false }, settles: null, motion: null,
  } } : initial;
}

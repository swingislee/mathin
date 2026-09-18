import { z } from "zod";
import { sha256HexSync } from "@/lib/sha256";
import { CLASSROOM_TOOL_STATE_SYNC_V1, classroomInteractionPayloadWithinBudget } from "@/features/classroom/sync/interaction-provider";
import { cubeClassroomEventSchema, type CubeClassroomSnapshot } from "./cube-structures-classroom";
import { diceWorkbenchStateSchema, netWorkbenchStateSchema, workbenchStateSchema } from "./workbench-classroom-contract";
import { fractionSceneSchema, motionSceneSchema, FRACTION_COURSEWARE_VERSION, MOTION_COURSEWARE_VERSION } from "./numeric-teaching-content";
import { CUBE_NET_COURSEWARE_VERSION, DICE_COURSEWARE_VERSION } from "./registry";

// 工具只在这里登记严格状态/动作合同。传输、课堂入口与实例状态容器不再识别具体工具。
export const classroomToolEventSchema = z.discriminatedUnion("contentVersion", [
  cubeClassroomEventSchema,
  cubeClassroomEventSchema.extend({ contentVersion: z.literal(CUBE_NET_COURSEWARE_VERSION), state: netWorkbenchStateSchema }),
  cubeClassroomEventSchema.extend({ contentVersion: z.literal(DICE_COURSEWARE_VERSION), state: diceWorkbenchStateSchema }),
  cubeClassroomEventSchema.extend({ toolId: z.literal("fraction-line"), contentVersion: z.literal(FRACTION_COURSEWARE_VERSION), state: workbenchStateSchema(fractionSceneSchema, z.never()) }),
  cubeClassroomEventSchema.extend({ toolId: z.literal("motion-lab"), contentVersion: z.literal(MOTION_COURSEWARE_VERSION), state: workbenchStateSchema(motionSceneSchema, z.never()) }),
]);
export type ClassroomToolStatePayload = z.infer<typeof classroomToolEventSchema>;
export type ClassroomToolUpdate = ClassroomToolStatePayload extends infer P ? P extends ClassroomToolStatePayload
  ? P extends { contentVersion: "cube-structures-lesson-v2" } ? Pick<P, "toolId" | "contentVersion"> & { state: CubeClassroomSnapshot }
    : Pick<P, "toolId" | "contentVersion" | "state"> : never : never;
export interface ClassroomToolStateEntry { readonly payload: ClassroomToolStatePayload; readonly sequences: Readonly<Record<string, number>> }
export type ClassroomToolStates = Readonly<Record<string, ClassroomToolStateEntry>>;
export interface ClassroomToolRuntime {
  readonly pageId: string; readonly docId: string; readonly states: ClassroomToolStates;
  readonly onChange?: (instanceId: string, originHash: string, update: ClassroomToolUpdate) => Promise<void>;
}
export interface CoursewareToolRuntime {
  readonly state?: ClassroomToolUpdate;
  readonly onChange?: (update: ClassroomToolUpdate) => Promise<void>;
}
export function hasClassroomToolAdapter(tool: { toolId: string; contentVersion: string }) {
  return classroomToolEventSchema.options.some((schema) => schema.shape.toolId.value === tool.toolId && schema.shape.contentVersion.value === tool.contentVersion);
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function coursewareToolOriginHash(payload: unknown) { return sha256HexSync(new TextEncoder().encode(JSON.stringify(canonical(payload)))); }
export function classroomToolInstanceKey(docId: string, instanceId: string, originHash: string) { return `${docId}:${instanceId}:${originHash}`; }
export function parseClassroomToolState(value: unknown): ClassroomToolStatePayload | null {
  if (!classroomInteractionPayloadWithinBudget(CLASSROOM_TOOL_STATE_SYNC_V1, value)) return null;
  const result = classroomToolEventSchema.safeParse(value);
  return result.success ? result.data : null;
}
export function createClassroomToolState(pageId: string, docId: string, instanceId: string, update: ClassroomToolUpdate, originHash: string): ClassroomToolStatePayload {
  const payload = parseClassroomToolState({ toolId: update.toolId, contentVersion: update.contentVersion, state: update.state,
    schema: "mathin-classroom-tool-state", version: 1, pageId, docId, instanceId, originHash });
  if (!payload) throw new Error("CLASSROOM_TOOL_STATE_INVALID_OR_TOO_LARGE");
  return payload;
}

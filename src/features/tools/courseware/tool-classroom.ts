import { z } from "zod";
import { CLASSROOM_TOOL_STATE_SYNC_V1, classroomInteractionPayloadWithinBudget } from "@/features/classroom/sync/interaction-provider";
import { cubeClassroomEventSchema, cubeRotationClassroomEventSchema, type CubeClassroomSnapshot } from "./cube-structures-classroom";
import { diceWorkbenchStateSchema, netWorkbenchStateSchema, workbenchStateSchema } from "./workbench-classroom-contract";
import { fractionSceneSchema, motionSceneSchema, FRACTION_COURSEWARE_VERSION, MOTION_COURSEWARE_VERSION } from "./numeric-teaching-content";
import { CUBE_NET_COURSEWARE_VERSION, DICE_COURSEWARE_VERSION } from "./registry";
import { toolClassroomEventSchema, toolSceneInstanceKey, toolSceneOriginHash } from "../scenes/classroom-envelope";
import { PROJECTION_COURSEWARE_VERSION, projectionSnapshotSchema } from "../projection/projection-contract";
import { SOLID_GEOMETRY_VERSION, solidGeometrySnapshotSchema } from "../solid-geometry/solid-geometry-contract";
import { CUBE_NET_EXPLORATION_VERSION, cubeNetExplorationStateSchema, NET_TEACHING_VERSION, netTeachingStateSchema } from "../net-teaching/contract";
import { SOLID_NETS_LESSON_VERSION, solidNetsTeachingSnapshotSchema, SOLID_NETS_POLYHEDRA_LESSON_VERSION, solidNetsPolyhedraSnapshotSchema } from "../solid-nets/contract";
import { SOLID_CAPACITY_VERSION, solidCapacitySnapshotSchema } from "../solid-capacity/solid-capacity-contract";
import { SOMA_VERSION, SOMA_LEGACY_VERSION, somaSnapshotSchema, somaLegacySnapshotSchema } from "../soma-cube/contract";
import { SOLID_NETS_COMPLETE_VERSION, solidNetsCompleteSnapshotSchema } from "../solid-nets/curved-contract";
import { SOLID_CAPACITY_TEACHING_VERSION, solidCapacityTeachingSnapshotSchema } from "../solid-capacity/solid-capacity-teaching-contract";
import { SOLID_GEOMETRY_EXPLORATION_VERSION, solidGeometryExplorationSnapshotSchema } from "../solid-geometry/exploration-contract";
import { SOLID_REVOLUTION_VERSION, solidRevolutionSnapshotSchema } from "../solid-revolution/contract";

// 工具只在这里登记严格状态/动作合同。传输、课堂入口与实例状态容器不再识别具体工具。
export const classroomToolEventSchema = z.discriminatedUnion("contentVersion", [
  toolClassroomEventSchema("solid-nets", SOLID_NETS_COMPLETE_VERSION, solidNetsCompleteSnapshotSchema),
  toolClassroomEventSchema("solid-capacity", SOLID_CAPACITY_TEACHING_VERSION, solidCapacityTeachingSnapshotSchema),
  toolClassroomEventSchema("solid-geometry", SOLID_GEOMETRY_EXPLORATION_VERSION, solidGeometryExplorationSnapshotSchema),
  toolClassroomEventSchema("solid-revolution", SOLID_REVOLUTION_VERSION, solidRevolutionSnapshotSchema),
  cubeClassroomEventSchema,
  cubeRotationClassroomEventSchema,
  toolClassroomEventSchema("spatial-lab", CUBE_NET_COURSEWARE_VERSION, netWorkbenchStateSchema),
  toolClassroomEventSchema("spatial-lab", DICE_COURSEWARE_VERSION, diceWorkbenchStateSchema),
  toolClassroomEventSchema("fraction-line", FRACTION_COURSEWARE_VERSION, workbenchStateSchema(fractionSceneSchema, z.never())),
  toolClassroomEventSchema("motion-lab", MOTION_COURSEWARE_VERSION, workbenchStateSchema(motionSceneSchema, z.never())),
  toolClassroomEventSchema("projection", PROJECTION_COURSEWARE_VERSION, projectionSnapshotSchema),
  toolClassroomEventSchema("solid-geometry", SOLID_GEOMETRY_VERSION, solidGeometrySnapshotSchema),
  toolClassroomEventSchema("spatial-lab", NET_TEACHING_VERSION, netTeachingStateSchema),
  toolClassroomEventSchema("spatial-lab", CUBE_NET_EXPLORATION_VERSION, cubeNetExplorationStateSchema),
  toolClassroomEventSchema("solid-nets", SOLID_NETS_LESSON_VERSION, solidNetsTeachingSnapshotSchema),
  toolClassroomEventSchema("solid-nets", SOLID_NETS_POLYHEDRA_LESSON_VERSION, solidNetsPolyhedraSnapshotSchema),
  toolClassroomEventSchema("solid-capacity", SOLID_CAPACITY_VERSION, solidCapacitySnapshotSchema),
  toolClassroomEventSchema("soma-cube", SOMA_VERSION, somaSnapshotSchema),
  toolClassroomEventSchema("soma-cube", SOMA_LEGACY_VERSION, somaLegacySnapshotSchema),
]);
export type ClassroomToolStatePayload = z.infer<typeof classroomToolEventSchema>;
export type ClassroomToolUpdate = ClassroomToolStatePayload extends infer P ? P extends ClassroomToolStatePayload
  ? P extends { contentVersion: "cube-structures-lesson-v2" | "cube-structures-lesson-v3" } ? Pick<P, "toolId" | "contentVersion"> & { state: CubeClassroomSnapshot }
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
export const coursewareToolOriginHash = toolSceneOriginHash;
export const classroomToolInstanceKey = toolSceneInstanceKey;
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

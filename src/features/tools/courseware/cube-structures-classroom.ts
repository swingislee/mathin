import { z } from "zod";
import { CLASSROOM_TOOL_STATE_SYNC_V1, classroomInteractionPayloadWithinBudget } from "@/features/classroom/sync/interaction-provider";
import { cubeHistorySchema } from "../spatial-lab/cube-structures-draft";
import { cubeSnapshotHistory, type CubeWorkbenchSession } from "../spatial-lab/cube-structures-session";
import type { CubeView } from "../spatial-lab/cube-structures-contract";
import type { CubeCoursewarePayload } from "./cube-structures-content";
import { CUBE_COURSEWARE_CONTENT_VERSION } from "./registry";
import { toolClassroomEventSchema, toolSceneInstanceKey, toolSceneOriginHash } from "../scenes/classroom-envelope";

export interface CubeClassroomSnapshot {
  readonly session: CubeWorkbenchSession;
  /** 回放期间的预设视角与课件步骤分离；自由轨道镜头仍属本机。 */
  readonly view: CubeView | null;
  readonly cameraRevision: number;
}

const sessionSchema = z.object({
  work: cubeHistorySchema, lesson: cubeHistorySchema.nullable(),
  recording: z.enum(["off", "recording", "paused"]), preview: z.number().int().min(0).nullable(),
}).strict().superRefine((session, context) => {
  if ((session.recording !== "off" && !session.lesson)
    || (session.preview !== null && (!session.lesson || session.preview > session.lesson.operations.length))
    || (session.preview !== null && session.recording === "recording")) {
    context.addIssue({ code: "custom", message: "Invalid classroom recording cursor" });
  }
});

export const cubeClassroomEventSchema = toolClassroomEventSchema("spatial-lab", CUBE_COURSEWARE_CONTENT_VERSION,
  z.object({ session: sessionSchema, view: z.enum(["angle", "front", "left", "right", "top"]).nullable(),
    cameraRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1) }).strict());

export type ClassroomToolStatePayload = z.infer<typeof cubeClassroomEventSchema>;
export interface ClassroomToolStateEntry {
  readonly payload: ClassroomToolStatePayload;
  /** 每个写者的水位保留在该实例内，跨端重发和乱序均可幂等回放。 */
  readonly sequences: Readonly<Record<string, number>>;
}
export type ClassroomToolStates = Readonly<Record<string, ClassroomToolStateEntry>>;
export interface ClassroomToolRuntime {
  readonly docId: string;
  readonly states: ClassroomToolStates;
  readonly onChange?: (instanceId: string, originHash: string, state: CubeClassroomSnapshot) => Promise<void>;
}
export interface CubeCoursewareRuntime {
  readonly state?: CubeClassroomSnapshot;
  readonly onChange?: (state: CubeClassroomSnapshot) => Promise<void>;
}

export function cubeCoursewareInitialSession(payload: CubeCoursewarePayload): CubeWorkbenchSession {
  return { work: cubeSnapshotHistory(payload.history.initial),
    lesson: payload.history.operations.length ? payload.history : null, recording: "off", preview: null };
}

export const cubeCoursewareOriginHash = toolSceneOriginHash;
export const classroomToolInstanceKey = toolSceneInstanceKey;

/** 收发两端使用同一严格合同；字节预算先于昂贵的历史重放校验。 */
export function parseClassroomToolState(value: unknown): ClassroomToolStatePayload | null {
  if (!classroomInteractionPayloadWithinBudget(CLASSROOM_TOOL_STATE_SYNC_V1, value)) return null;
  const result = cubeClassroomEventSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function createClassroomToolState(pageId: string, docId: string, instanceId: string, state: CubeClassroomSnapshot, originHash: string): ClassroomToolStatePayload {
  const payload = parseClassroomToolState({ schema: "mathin-classroom-tool-state", version: 1,
    pageId, docId, instanceId, originHash, toolId: "spatial-lab", contentVersion: CUBE_COURSEWARE_CONTENT_VERSION, state });
  if (!payload) throw new Error("CLASSROOM_TOOL_STATE_INVALID_OR_TOO_LARGE");
  return payload;
}

import { z } from "zod";
import { sha256HexSync } from "@/lib/sha256";
import { CLASSROOM_TOOL_STATE_SYNC_V1, classroomInteractionPayloadWithinBudget } from "@/features/classroom/sync/interaction-provider";
import { cubeHistorySchema } from "../spatial-lab/cube-structures-draft";
import { cubeSnapshotHistory, type CubeWorkbenchSession } from "../spatial-lab/cube-structures-session";
import type { CubeView } from "../spatial-lab/cube-structures-contract";
import type { CubeCoursewarePayload } from "./cube-structures-content";
import { CUBE_COURSEWARE_CONTENT_VERSION } from "./registry";

export interface CubeClassroomSnapshot {
  readonly session: CubeWorkbenchSession;
  /** 回放期间的预设视角与课件步骤分离；自由轨道镜头仍属本机。 */
  readonly view: CubeView | null;
  readonly cameraRevision: number;
}

const identifier = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/)
  .refine((value) => !["__proto__", "constructor", "prototype"].includes(value));
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

export const cubeClassroomEventSchema = z.object({
  schema: z.literal("mathin-classroom-tool-state"), version: z.literal(1),
  pageId: identifier, docId: identifier, instanceId: identifier,
  originHash: z.string().regex(/^[a-f0-9]{64}$/),
  toolId: z.literal("spatial-lab"), contentVersion: z.literal(CUBE_COURSEWARE_CONTENT_VERSION),
  state: z.object({ session: sessionSchema, view: z.enum(["angle", "front", "left", "right", "top"]).nullable(),
    cameraRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1) }).strict(),
}).strict();

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

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => [key, canonical(item)]));
  return value;
}

/** 固定副本变化时使用新的状态命名空间；兼容局域网 HTTP，不依赖安全上下文。 */
export function cubeCoursewareOriginHash(payload: CubeCoursewarePayload): string {
  return sha256HexSync(new TextEncoder().encode(JSON.stringify(canonical(payload))));
}

export function classroomToolInstanceKey(docId: string, instanceId: string, originHash: string): string {
  return `${docId}:${instanceId}:${originHash}`;
}

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

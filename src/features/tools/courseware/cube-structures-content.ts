import { z } from "zod";
import { cubeHistorySchema, parseCubeDraftSnapshot, type CubeDraftSnapshot } from "../spatial-lab/cube-structures-draft";
import { replayCubeHistory } from "../spatial-lab/cube-structures-contract";
import { cubeSnapshotHistory } from "../spatial-lab/cube-structures-session";
import { CUBE_COURSEWARE_CONTENT_VERSION } from "./registry";

export { CUBE_COURSEWARE_CONTENT_VERSION } from "./registry";
export const CUBE_COURSEWARE_MAX_BYTES = 512_000;
/** 给现有 Server Action 的 1 MB 信封预留空间；旧组合页合同保持原上限。 */
export const CUBE_COURSEWARE_PAGE_MAX_BYTES = 750_000;

export const cubeCoursewarePayloadSchema = z.object({
  title: z.string().trim().min(1).max(80),
  history: cubeHistorySchema.refine((history) => history.cursor === 0, "Courseware starts at its recorded origin"),
}).strict().superRefine((payload, context) => {
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > CUBE_COURSEWARE_MAX_BYTES) {
    context.addIssue({ code: "custom", message: "Cube courseware exceeds the content size limit" });
  }
});

export const cubeCoursewareToolSchema = z.object({
  toolId: z.literal("spatial-lab"),
  contentVersion: z.literal(CUBE_COURSEWARE_CONTENT_VERSION),
  payload: cubeCoursewarePayloadSchema,
}).strict();

export type CubeCoursewarePayload = z.infer<typeof cubeCoursewarePayloadSchema>;
export type CubeCoursewareTool = z.infer<typeof cubeCoursewareToolSchema>;
export type CubeCoursewareSource = "current" | "recording";

/** 自包含固定副本：不保存账号/草稿 ID，不携带自由操作、撤销尾部或播放进度。 */
export function createCubeCoursewareTool(input: { name: string; snapshot: CubeDraftSnapshot }, source: CubeCoursewareSource): CubeCoursewareTool {
  const { session } = parseCubeDraftSnapshot(input.snapshot);
  if (source === "recording" && !session.lesson) throw new Error("CUBE_COURSEWARE_RECORDING_MISSING");
  const history = source === "recording" && session.lesson
    ? { ...session.lesson, operations: session.lesson.operations.slice(0, session.lesson.cursor), cursor: 0 }
    : cubeSnapshotHistory(replayCubeHistory(session.work));
  return cubeCoursewareToolSchema.parse({
    toolId: "spatial-lab", contentVersion: CUBE_COURSEWARE_CONTENT_VERSION,
    payload: { title: input.name, history },
  });
}

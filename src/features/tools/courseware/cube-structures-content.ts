import { z } from "zod";
import { cubeHistorySchema, parseCubeDraftSnapshot, type CubeDraftSnapshot } from "../spatial-lab/cube-structures-draft";
import { replayCubeHistory } from "../spatial-lab/cube-structures-contract";
import { cubeSnapshotHistory } from "../spatial-lab/cube-structures-session";
import { CUBE_TOOLBAR_IDS, type CubeToolbarId } from "../spatial-lab/cube-structures-toolbar";
import { CUBE_COURSEWARE_CONTENT_VERSION, CUBE_COURSEWARE_LEGACY_VERSION } from "./registry";

export { CUBE_COURSEWARE_CONTENT_VERSION, CUBE_COURSEWARE_LEGACY_VERSION } from "./registry";
export const CUBE_COURSEWARE_MAX_BYTES = 512_000;
/** 给现有 Server Action 的 1 MB 信封预留空间；旧组合页合同保持原上限。 */
export const CUBE_COURSEWARE_PAGE_MAX_BYTES = 750_000;

const payloadFields = {
  title: z.string().trim().min(1).max(80),
  history: cubeHistorySchema.refine((history) => history.cursor === 0, "Courseware starts at its recorded origin"),
};
function checkSize(payload: unknown, context: z.RefinementCtx) {
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > CUBE_COURSEWARE_MAX_BYTES) {
    context.addIssue({ code: "custom", message: "Cube courseware exceeds the content size limit" });
  }
}
const legacyPayloadSchema = z.object(payloadFields).strict().superRefine(checkSize);
export const cubeToolbarSchema = z.array(z.enum(CUBE_TOOLBAR_IDS)).max(CUBE_TOOLBAR_IDS.length)
  .refine((ids) => new Set(ids).size === ids.length, "Toolbar tools must be unique");
export const cubeCoursewarePayloadSchema = z.object({ ...payloadFields, toolbar: cubeToolbarSchema }).strict().superRefine(checkSize);

export const cubeCoursewareV2ToolSchema = z.object({
  toolId: z.literal("spatial-lab"),
  contentVersion: z.literal(CUBE_COURSEWARE_CONTENT_VERSION),
  payload: cubeCoursewarePayloadSchema,
}).strict();
export const cubeCoursewareV1ToolSchema = z.object({
  toolId: z.literal("spatial-lab"), contentVersion: z.literal(CUBE_COURSEWARE_LEGACY_VERSION), payload: legacyPayloadSchema,
}).strict();
export const cubeCoursewareToolSchema = z.discriminatedUnion("contentVersion", [cubeCoursewareV1ToolSchema, cubeCoursewareV2ToolSchema]);

export type CubeCoursewarePayload = z.infer<typeof cubeCoursewarePayloadSchema> | z.infer<typeof legacyPayloadSchema>;
export type CubeCoursewareTool = z.infer<typeof cubeCoursewareToolSchema>;
export type CubeCoursewareSource = "current" | "recording";

/** 自包含固定副本：不保存账号/草稿 ID，不携带自由操作、撤销尾部或播放进度。 */
export function createCubeCoursewareTool(input: { name: string; snapshot: CubeDraftSnapshot }, source: CubeCoursewareSource, toolbar: readonly CubeToolbarId[] = CUBE_TOOLBAR_IDS): z.infer<typeof cubeCoursewareV2ToolSchema> {
  const { session } = parseCubeDraftSnapshot(input.snapshot);
  if (source === "recording" && !session.lesson) throw new Error("CUBE_COURSEWARE_RECORDING_MISSING");
  const history = source === "recording" && session.lesson
    ? { ...session.lesson, operations: session.lesson.operations.slice(0, session.lesson.cursor), cursor: 0 }
    : cubeSnapshotHistory(replayCubeHistory(session.work));
  return cubeCoursewareV2ToolSchema.parse({
    toolId: "spatial-lab", contentVersion: CUBE_COURSEWARE_CONTENT_VERSION,
    payload: { title: input.name, history, toolbar },
  });
}

export function isCubeCoursewareTool(tool: { contentVersion: string }): tool is CubeCoursewareTool {
  return tool.contentVersion === CUBE_COURSEWARE_CONTENT_VERSION || tool.contentVersion === CUBE_COURSEWARE_LEGACY_VERSION;
}

/** 只在编辑器明确应用时升级；旧发布内容保持原样。 */
export function configureCubeCoursewareToolbar(tool: CubeCoursewareTool, toolbar: readonly CubeToolbarId[]) {
  return cubeCoursewareV2ToolSchema.parse({ ...tool, contentVersion: CUBE_COURSEWARE_CONTENT_VERSION, payload: { ...tool.payload, toolbar } });
}

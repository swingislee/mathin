import { z } from "zod";
import { cubeCoursewareV2ToolSchema } from "../courseware/cube-structures-content";
import { spatialTeachingToolSchema } from "../courseware/spatial-teaching-content";
import { numericTeachingToolSchema } from "./numeric-teaching-content";
import { projectionToolSchema } from "../projection/projection-contract";
import { getToolCoursewareContract, toolCoursewareContractsForSurface } from "./registry";

/** Tools 共用的自包含现场：工具身份 + 参数版本 + 严格参数；与草稿、课件、课堂宿主无关。 */
export const toolSceneSchema = z.discriminatedUnion("contentVersion", [cubeCoursewareV2ToolSchema, ...spatialTeachingToolSchema.options, ...numericTeachingToolSchema.options, projectionToolSchema]);
export type ToolScene = z.infer<typeof toolSceneSchema>;
export type ToolSceneVersion = ToolScene["contentVersion"];
export const TOOL_SCENE_MAX_BYTES = 512_000;
export function parseToolScene(value: unknown): ToolScene {
  const scene = toolSceneSchema.parse(value);
  if (new TextEncoder().encode(JSON.stringify(scene)).byteLength > TOOL_SCENE_MAX_BYTES) throw new Error("TOOL_SCENE_TOO_LARGE");
  return scene;
}
export function isToolScene(value: { contentVersion: string }): value is ToolScene {
  return toolSceneSchema.options.some((schema) => schema.shape.contentVersion.value === value.contentVersion);
}
/** 旧空间副本保留其 wire ID；对外目录始终使用独立教具身份。 */
export function toolSceneCatalogId(scene: Pick<ToolScene, "toolId" | "contentVersion">) {
  const definition = getToolCoursewareContract(scene.toolId, scene.contentVersion);
  return definition && "catalogId" in definition ? definition.catalogId : scene.toolId;
}
export const preparedToolDefinitions = toolCoursewareContractsForSurface;

/** 每次插入复制完整参数，课件不引用会继续变化的草稿记录。 */
export function freezeToolScene(value: unknown): ToolScene {
  return parseToolScene(structuredClone(value));
}

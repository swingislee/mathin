import { z } from "zod";
import { localizedTextSchema, SPATIAL_SCENE_LIMITS } from "./scene-schema";
import { compareVoxelCoordinates, voxelCoordinateListSchema } from "./voxel-schema";
import { AXES } from "./voxel-types";

export const VOXEL_SCENE_ADAPTER_VERSION = "voxel-scene-adapter-v1" as const;

const stableIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "invalid stable id");
const semanticTokenSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/, "invalid semantic token");

export const voxelSceneAdapterInputSchema = z
  .object({
    adapterVersion: z.literal(VOXEL_SCENE_ADAPTER_VERSION),
    sceneId: stableIdSchema,
    entityId: stableIdSchema,
    title: localizedTextSchema,
    learningGoal: localizedTextSchema,
    teacherPrompt: localizedTextSchema,
    misconception: localizedTextSchema,
    cells: voxelCoordinateListSchema.min(1),
    layerAxis: z.enum(AXES),
    materialToken: semanticTokenSchema,
    termIds: z.array(stableIdSchema).min(1).max(32),
    prerequisiteTermIds: z.array(stableIdSchema).max(32),
    createdBy: stableIdSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.cells.some((cell, index) => index > 0 && compareVoxelCoordinates(input.cells[index - 1], cell) > 0)) {
      context.addIssue({ code: "custom", message: "adapter cells must use stable coordinate order", path: ["cells"] });
    }
    const layerCoordinates = new Set(input.cells.map((cell) => cell[input.layerAxis]));
    if (layerCoordinates.size > Math.min(SPATIAL_SCENE_LIMITS.maxLayers, SPATIAL_SCENE_LIMITS.maxActionsPerStep - 1)) {
      context.addIssue({ code: "custom", message: "adapter exceeds the authored layer-step limit", path: ["cells"] });
    }
    for (const [path, values] of [
      ["termIds", input.termIds],
      ["prerequisiteTermIds", input.prerequisiteTermIds],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", message: `${path} must be unique`, path: [path] });
      }
      if (values.some((value, index) => index > 0 && values[index - 1] > value)) {
        context.addIssue({ code: "custom", message: `${path} must use stable order`, path: [path] });
      }
    }
  });

export type VoxelSceneAdapterInput = z.infer<typeof voxelSceneAdapterInputSchema>;

export function parseVoxelSceneAdapterInput(input: unknown): VoxelSceneAdapterInput {
  return voxelSceneAdapterInputSchema.parse(input);
}

import { z } from "zod";
import { stableIdSchema } from "./scene-schema";
import { compareVoxelCoordinates, voxelCoordinateSchema } from "./voxel-schema";
import { SPATIAL_VOXEL_LIMITS } from "./voxel-types";

export const VOXEL_CARVING_VERSION = "voxel-carving-v1" as const;

export const voxelCarvingStateSchema = z
  .object({
    carvingVersion: z.literal(VOXEL_CARVING_VERSION),
    entityId: stableIdSchema,
    removedCells: z.array(voxelCoordinateSchema).max(SPATIAL_VOXEL_LIMITS.maxCells),
  })
  .strict()
  .superRefine((state, context) => {
    for (let index = 1; index < state.removedCells.length; index += 1) {
      const comparison = compareVoxelCoordinates(state.removedCells[index - 1], state.removedCells[index]);
      if (comparison >= 0) {
        context.addIssue({
          code: "custom",
          path: ["removedCells", index],
          message: comparison === 0 ? "duplicate removed voxel" : "removed voxels must use canonical order",
        });
      }
    }
  });

export type VoxelCarvingState = z.infer<typeof voxelCarvingStateSchema>;

export function parseVoxelCarvingState(input: unknown): VoxelCarvingState {
  return voxelCarvingStateSchema.parse(input);
}

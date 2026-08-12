import { z } from "zod";
import { semanticTokenSchema, stableIdSchema } from "./scene-schema";
import { compareVoxelCoordinates, voxelCoordinateSchema } from "./voxel-schema";
import { FACE_DIRECTIONS } from "./voxel-types";

export const VOXEL_FACE_PAINT_VERSION = "voxel-face-paint-v1" as const;
export const VOXEL_FACE_PAINT_LIMITS = {
  maxFaces: 49_152,
} as const;

export const voxelFaceSelectionSchema = z
  .object({
    cell: voxelCoordinateSchema,
    direction: z.enum(FACE_DIRECTIONS),
  })
  .strict();

const directionIndex = new Map(FACE_DIRECTIONS.map((direction, index) => [direction, index]));

export function compareVoxelFaceSelections(
  left: VoxelFaceSelection,
  right: VoxelFaceSelection,
): number {
  return (
    compareVoxelCoordinates(left.cell, right.cell) ||
    (directionIndex.get(left.direction) ?? 0) - (directionIndex.get(right.direction) ?? 0)
  );
}

export const voxelFacePaintStateSchema = z
  .object({
    paintVersion: z.literal(VOXEL_FACE_PAINT_VERSION),
    entityId: stableIdSchema,
    materialToken: semanticTokenSchema,
    faces: z.array(voxelFaceSelectionSchema).max(VOXEL_FACE_PAINT_LIMITS.maxFaces),
  })
  .strict()
  .superRefine((state, context) => {
    for (let index = 1; index < state.faces.length; index += 1) {
      const comparison = compareVoxelFaceSelections(state.faces[index - 1], state.faces[index]);
      if (comparison >= 0) {
        context.addIssue({
          code: "custom",
          path: ["faces", index],
          message: comparison === 0 ? "duplicate painted face" : "painted faces must use canonical order",
        });
      }
    }
  });

export type VoxelFaceSelection = z.infer<typeof voxelFaceSelectionSchema>;
export type VoxelFacePaintState = z.infer<typeof voxelFacePaintStateSchema>;

export function parseVoxelFaceSelection(input: unknown): VoxelFaceSelection {
  return voxelFaceSelectionSchema.parse(input);
}

export function parseVoxelFacePaintState(input: unknown): VoxelFacePaintState {
  return voxelFacePaintStateSchema.parse(input);
}

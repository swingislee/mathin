import { z } from "zod";

export const CUBE_NET_FOLDING_PRESET_VERSION = "cube-net-folding-preset-v1" as const;
export const CUBE_NET_FOLDING_PRESET_ID = "cube-net.cross-opposite-face.v1" as const;

export const cubeNetFoldingPresetRequestSchema = z
  .object({
    presetVersion: z.literal(CUBE_NET_FOLDING_PRESET_VERSION),
    presetId: z.literal(CUBE_NET_FOLDING_PRESET_ID),
  })
  .strict();

export type CubeNetFoldingPresetRequest = z.infer<
  typeof cubeNetFoldingPresetRequestSchema
>;

export function parseCubeNetFoldingPresetRequest(
  input: unknown,
): CubeNetFoldingPresetRequest {
  return cubeNetFoldingPresetRequestSchema.parse(input);
}

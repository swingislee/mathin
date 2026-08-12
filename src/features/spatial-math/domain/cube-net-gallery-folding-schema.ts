import { z } from "zod";
import {
  CUBE_NET_GALLERY_VERSION,
  cubeNetGalleryEntrySchema,
} from "./cube-net-gallery-schema";

export const CUBE_NET_GALLERY_FOLDING_VERSION = "cube-net-gallery-folding-v1" as const;

export const cubeNetGalleryFoldingRequestSchema = z
  .object({
    foldingVersion: z.literal(CUBE_NET_GALLERY_FOLDING_VERSION),
    galleryVersion: z.literal(CUBE_NET_GALLERY_VERSION),
    entryId: cubeNetGalleryEntrySchema.shape.id,
  })
  .strict();

export type CubeNetGalleryFoldingRequest = z.infer<typeof cubeNetGalleryFoldingRequestSchema>;

export function parseCubeNetGalleryFoldingRequest(input: unknown): CubeNetGalleryFoldingRequest {
  return cubeNetGalleryFoldingRequestSchema.parse(input);
}

import { z } from "zod";
import { canonicalJsonStringify } from "./canonical-json";
import { CUBE_NET_ANALYSIS_REASONS } from "./cube-net-kernel";
import { unitSquareNetSchema } from "./net-schema";

export const CUBE_NET_GALLERY_VERSION = "cube-net-gallery-v1" as const;

export const CUBE_NET_GALLERY_LIMITS = {
  entryCount: 35,
  legalCount: 11,
  invalidCount: 24,
  maxBytes: 64 * 1_024,
} as const;

const classificationSchema = z.enum(["legal", "invalid"]);
const analysisReasonSchema = z.enum([
  CUBE_NET_ANALYSIS_REASONS.valid,
  CUBE_NET_ANALYSIS_REASONS.orientationConflict,
  CUBE_NET_ANALYSIS_REASONS.faceOverlap,
]);

export const cubeNetGalleryEntrySchema = z
  .object({
    id: z.string().regex(/^cube-net-gallery\.[0-9]{2}$/),
    catalogOrdinal: z.number().int().min(1).max(CUBE_NET_GALLERY_LIMITS.entryCount),
    classificationOrdinal: z.number().int().min(1).max(CUBE_NET_GALLERY_LIMITS.invalidCount),
    canonicalKey: z.string().min(1).max(160),
    classification: classificationSchema,
    reason: analysisReasonSchema,
    adjacencyEdgeCount: z.number().int().min(0).max(12),
    net: unitSquareNetSchema.refine((value) => value.cells.length === 6, "gallery entries require six cells"),
  })
  .strict()
  .superRefine((entry, context) => {
    if ((entry.classification === "legal") !== (entry.reason === CUBE_NET_ANALYSIS_REASONS.valid)) {
      context.addIssue({ code: "custom", message: "classification must match the kernel reason", path: ["reason"] });
    }
    const maximumOrdinal = entry.classification === "legal"
      ? CUBE_NET_GALLERY_LIMITS.legalCount
      : CUBE_NET_GALLERY_LIMITS.invalidCount;
    if (entry.classificationOrdinal > maximumOrdinal) {
      context.addIssue({ code: "custom", message: "classification ordinal exceeds its partition", path: ["classificationOrdinal"] });
    }
  });

export const cubeNetGalleryCatalogSchema = z
  .object({
    galleryVersion: z.literal(CUBE_NET_GALLERY_VERSION),
    entries: z.array(cubeNetGalleryEntrySchema).length(CUBE_NET_GALLERY_LIMITS.entryCount),
  })
  .strict()
  .superRefine((catalog, context) => {
    const ids = catalog.entries.map((entry) => entry.id);
    const keys = catalog.entries.map((entry) => entry.canonicalKey);
    if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "gallery ids must be unique", path: ["entries"] });
    if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", message: "gallery keys must be unique", path: ["entries"] });
    catalog.entries.forEach((entry, index) => {
      if (entry.catalogOrdinal !== index + 1) {
        context.addIssue({ code: "custom", message: "gallery ordinals must be contiguous", path: ["entries", index, "catalogOrdinal"] });
      }
      if (index > 0 && catalog.entries[index - 1].canonicalKey > entry.canonicalKey) {
        context.addIssue({ code: "custom", message: "gallery entries must use canonical order", path: ["entries"] });
      }
    });
    const legal = catalog.entries.filter((entry) => entry.classification === "legal");
    const invalid = catalog.entries.filter((entry) => entry.classification === "invalid");
    if (legal.length !== CUBE_NET_GALLERY_LIMITS.legalCount || invalid.length !== CUBE_NET_GALLERY_LIMITS.invalidCount) {
      context.addIssue({ code: "custom", message: "gallery must partition 35 hexominoes into 11 legal and 24 invalid", path: ["entries"] });
    }
    for (const partition of [legal, invalid]) {
      partition.forEach((entry, index) => {
        if (entry.classificationOrdinal !== index + 1) {
          context.addIssue({ code: "custom", message: "classification ordinals must be contiguous", path: ["entries"] });
        }
      });
    }
    const bytes = new TextEncoder().encode(canonicalJsonStringify(catalog)).byteLength;
    if (bytes > CUBE_NET_GALLERY_LIMITS.maxBytes) {
      context.addIssue({ code: "custom", message: `gallery size ${bytes} exceeds limit`, path: [] });
    }
  });

export const cubeNetGalleryPredictionSchema = z
  .object({
    galleryVersion: z.literal(CUBE_NET_GALLERY_VERSION),
    entryId: cubeNetGalleryEntrySchema.shape.id,
    prediction: classificationSchema,
  })
  .strict();

export const cubeNetGalleryEvaluationSchema = z
  .object({
    galleryVersion: z.literal(CUBE_NET_GALLERY_VERSION),
    entryId: cubeNetGalleryEntrySchema.shape.id,
    prediction: classificationSchema,
    actual: classificationSchema,
    correct: z.boolean(),
    reason: analysisReasonSchema,
  })
  .strict();

export type CubeNetGalleryClassification = z.infer<typeof classificationSchema>;
export type CubeNetGalleryEntry = z.infer<typeof cubeNetGalleryEntrySchema>;
export type CubeNetGalleryCatalog = z.infer<typeof cubeNetGalleryCatalogSchema>;
export type CubeNetGalleryPrediction = z.infer<typeof cubeNetGalleryPredictionSchema>;
export type CubeNetGalleryEvaluation = z.infer<typeof cubeNetGalleryEvaluationSchema>;

export function parseCubeNetGalleryCatalog(input: unknown): CubeNetGalleryCatalog {
  return cubeNetGalleryCatalogSchema.parse(input);
}

export function parseCubeNetGalleryPrediction(input: unknown): CubeNetGalleryPrediction {
  return cubeNetGalleryPredictionSchema.parse(input);
}

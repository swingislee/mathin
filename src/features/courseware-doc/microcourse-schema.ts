import { z } from "zod";
import { aixuexiPageDocSchema, type AixuexiPageDoc } from "./aixuexi-schema";
import { pageDocSchema, type PageDoc } from "./schema";
import { gamePageDocSchema, type GamePageDoc } from "./game-page-schema";
import {
  sourceRuntimePageDocSchema,
  type SourceRuntimePageDoc,
} from "./source-runtime-schema";
import {
  spatialPageDocSchema,
  type SpatialPageDoc,
} from "@/features/spatial-math/domain/page-schema";

export const MICROCOURSE_PAGE_DOC_VERSION = "microcourse-page-v1" as const;
export const MICROCOURSE_H5_MAX_BYTES = 5 * 1_024 * 1_024;

const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const microcourseCanvasSchema = z
  .object({
    width: z.literal(960),
    height: z.literal(720),
    backgroundColor: z.string().nullable(),
  })
  .strict();

/**
 * A copied source is limited to registered first-party published document
 * formats. A teacher microcourse can therefore never recursively embed another
 * teacher microcourse; game-page-v1 is flattened as one immutable source doc.
 */
export const microcourseSourceDocSchema = z.union([
  pageDocSchema,
  aixuexiPageDocSchema,
  spatialPageDocSchema,
  gamePageDocSchema,
  sourceRuntimePageDocSchema,
]);

export const microcourseSourceSnapshotSchema = z
  .object({
    sourceFamilyId: z.uuid(),
    sourceCourseId: z.uuid(),
    sourceLectureId: z.uuid(),
    sourceReleaseId: z.uuid(),
    sourcePageDocId: z.uuid(),
    sourceRevisionId: z.uuid(),
    sourcePageNo: z.number().int().positive(),
    sourceTitle: z.string().min(1).max(200),
    doc: microcourseSourceDocSchema,
  })
  .strict();

export const legacyMicrocourseCompositionPageSchema = z
  .object({
    docVersion: z.literal(MICROCOURSE_PAGE_DOC_VERSION),
    mode: z.literal("composition"),
    canvas: microcourseCanvasSchema,
    source: microcourseSourceSnapshotSchema.nullable(),
    /** Teacher-owned page-doc-v1 nodes rendered above the immutable source. */
    overlay: pageDocSchema,
  })
  .strict()
  .superRefine((page, context) => {
    if (
      page.overlay.canvas.width !== page.canvas.width
      || page.overlay.canvas.height !== page.canvas.height
    ) {
      context.addIssue({
        code: "custom",
        path: ["overlay", "canvas"],
        message: "overlay canvas must match the microcourse canvas",
      });
    }
  });

const h5PageSchema = z
  .object({
    docVersion: z.literal(MICROCOURSE_PAGE_DOC_VERSION),
    mode: z.literal("h5"),
    canvas: microcourseCanvasSchema,
    artifactId: z.uuid(),
    sha256: sha256HexSchema,
    byteCount: z.number().int().nonnegative().max(MICROCOURSE_H5_MAX_BYTES),
    entryPath: z.literal("index.html"),
  })
  .strict();

export const microcoursePageDocSchema = z.union([
  legacyMicrocourseCompositionPageSchema,
  h5PageSchema,
]);

export type MicrocourseSourceDoc = PageDoc | AixuexiPageDoc | SpatialPageDoc | GamePageDoc | SourceRuntimePageDoc;
export type MicrocourseSourceSnapshot = z.infer<typeof microcourseSourceSnapshotSchema>;
export type MicrocoursePageDoc = z.infer<typeof microcoursePageDocSchema>;

export function isMicrocoursePageDoc(
  doc: { readonly docVersion: string },
): doc is MicrocoursePageDoc {
  return doc.docVersion === MICROCOURSE_PAGE_DOC_VERSION;
}

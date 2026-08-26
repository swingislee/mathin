import { z } from "zod";
import { aixuexiPageDocSchema, type AixuexiPageDoc } from "./aixuexi-schema";
import { pageDocSchema, type PageDoc } from "./schema";
import {
  spatialPageDocSchema,
  type SpatialPageDoc,
} from "@/features/spatial-math/domain/page-schema";

export const MICROCOURSE_PAGE_DOC_VERSION = "microcourse-page-v1" as const;
export const MICROCOURSE_H5_MAX_BYTES = 5 * 1_024 * 1_024;

const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
const sudokuGridSchema = z.array(z.number().int().min(0).max(9)).length(81);

export const microcourseCanvasSchema = z
  .object({
    width: z.literal(960),
    height: z.literal(720),
    backgroundColor: z.string().nullable(),
  })
  .strict();

/**
 * A copied source is intentionally limited to the three first-party published
 * document formats. A teacher microcourse can therefore never recursively
 * embed another teacher microcourse.
 */
export const microcourseSourceDocSchema = z.union([
  pageDocSchema,
  aixuexiPageDocSchema,
  spatialPageDocSchema,
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

const compositionPageSchema = z
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

export const sudokuAnalysisSchema = z
  .object({
    status: z.enum(["conflict", "unsolvable", "multiple", "unique"]),
    /** 2 means at least two solutions; counting deliberately stops there. */
    solutionCount: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    solution: sudokuGridSchema.nullable(),
  })
  .strict()
  .superRefine((analysis, context) => {
    const expectedCount = analysis.status === "unique" ? 1
      : analysis.status === "multiple" ? 2
        : 0;
    if (analysis.solutionCount !== expectedCount) {
      context.addIssue({
        code: "custom",
        path: ["solutionCount"],
        message: "solutionCount does not match status",
      });
    }
    if ((analysis.status === "unique") !== (analysis.solution !== null)) {
      context.addIssue({
        code: "custom",
        path: ["solution"],
        message: "only a unique puzzle may carry its solution",
      });
    }
    if (analysis.solution && analysis.solution.some((digit) => digit === 0)) {
      context.addIssue({
        code: "custom",
        path: ["solution"],
        message: "a computed solution must be complete",
      });
    }
  });

const sudokuPageSchema = z
  .object({
    docVersion: z.literal(MICROCOURSE_PAGE_DOC_VERSION),
    mode: z.literal("sudoku"),
    canvas: microcourseCanvasSchema,
    puzzle: sudokuGridSchema,
    display: z
      .object({
        showCoordinates: z.boolean(),
        allowCandidates: z.boolean(),
        allowAnswerReveal: z.boolean(),
        showTeachingTools: z.boolean(),
      })
      .strict(),
    analysis: sudokuAnalysisSchema,
  })
  .strict();

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
  compositionPageSchema,
  sudokuPageSchema,
  h5PageSchema,
]);

export type MicrocourseSourceDoc = PageDoc | AixuexiPageDoc | SpatialPageDoc;
export type MicrocourseSourceSnapshot = z.infer<typeof microcourseSourceSnapshotSchema>;
export type SudokuAnalysis = z.infer<typeof sudokuAnalysisSchema>;
export type MicrocoursePageDoc = z.infer<typeof microcoursePageDocSchema>;

export function isMicrocoursePageDoc(
  doc: { readonly docVersion: string },
): doc is MicrocoursePageDoc {
  return doc.docVersion === MICROCOURSE_PAGE_DOC_VERSION;
}


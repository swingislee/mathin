import { z } from "zod";
import {
  DEFAULT_SUDOKU_VARIANT_ID,
  getSudokuVariant,
  SUDOKU_VARIANTS,
  type SudokuVariantId,
} from "./variant";

export const SUDOKU_AUTHORED_CONTENT_VERSION = "sudoku-authored-v1" as const;

const sudokuVariantIds = SUDOKU_VARIANTS.map((variant) => variant.id) as [
  SudokuVariantId,
  ...SudokuVariantId[],
];

export const sudokuAuthoredDisplaySchema = z.object({
  showCoordinates: z.boolean(),
  allowCandidates: z.boolean(),
  allowAnswerReveal: z.boolean(),
  showTeachingTools: z.boolean(),
}).strict();

export const sudokuAuthoredPayloadSchema = z.object({
  kind: z.literal("authored"),
  variantId: z.enum(sudokuVariantIds),
  puzzle: z.array(z.number().int()),
  display: sudokuAuthoredDisplaySchema,
}).strict().superRefine((payload, context) => {
  const variant = getSudokuVariant(payload.variantId);
  if (!variant) {
    context.addIssue({
      code: "custom",
      path: ["variantId"],
      message: "unknown Sudoku variant",
    });
    return;
  }
  if (payload.puzzle.length !== variant.size * variant.size) {
    context.addIssue({
      code: "custom",
      path: ["puzzle"],
      message: `puzzle must contain ${variant.size * variant.size} cells`,
    });
  }
  payload.puzzle.forEach((digit, index) => {
    if (digit < 0 || digit > variant.size) {
      context.addIssue({
        code: "custom",
        path: ["puzzle", index],
        message: `digit must be between 0 and ${variant.size}`,
      });
    }
  });
});

export type SudokuAuthoredPayload = z.infer<typeof sudokuAuthoredPayloadSchema>;
export type SudokuAuthoredDisplay = z.infer<typeof sudokuAuthoredDisplaySchema>;

export function createDefaultSudokuAuthoredPayload(
  variantId: SudokuVariantId = DEFAULT_SUDOKU_VARIANT_ID,
): SudokuAuthoredPayload {
  const variant = getSudokuVariant(variantId);
  if (!variant) throw new Error(`Unknown Sudoku variant: ${variantId}`);
  return {
    kind: "authored",
    variantId,
    puzzle: Array.from({ length: variant.size * variant.size }, () => 0),
    display: {
      showCoordinates: true,
      allowCandidates: true,
      allowAnswerReveal: false,
      showTeachingTools: true,
    },
  };
}


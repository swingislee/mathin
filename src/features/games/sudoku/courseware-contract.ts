import { z } from "zod";
import {
  DEFAULT_SUDOKU_VARIANT_ID,
  getSudokuVariant,
  SUDOKU_VARIANTS,
  type SudokuVariantId,
} from "./variant";

export const SUDOKU_AUTHORED_CONTENT_VERSION = "sudoku-authored-v1" as const;
export const SUDOKU_ACTIVITY_CONTENT_VERSION = "sudoku-authored-v2" as const;

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

const sudokuTeachingTargetSchema = z.object({
  kind: z.literal("cell-value"),
  index: z.number().int().nonnegative(),
  value: z.number().int().positive(),
}).strict();

export const sudokuActivityGoalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("full-solution"),
    requireUnique: z.literal(true),
  }).strict(),
  z.object({
    kind: z.literal("teaching-target"),
    targets: z.array(sudokuTeachingTargetSchema).max(12),
  }).strict(),
  z.object({ kind: z.literal("teacher-led") }).strict(),
]);

export const sudokuActivityPayloadSchema = z.object({
  kind: z.literal("authored-activity"),
  variantId: z.enum(sudokuVariantIds),
  puzzle: z.array(z.number().int()),
  goal: sudokuActivityGoalSchema,
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
  const cellCount = variant.size * variant.size;
  if (payload.puzzle.length !== cellCount) {
    context.addIssue({
      code: "custom",
      path: ["puzzle"],
      message: `puzzle must contain ${cellCount} cells`,
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
  if (payload.goal.kind !== "teaching-target") return;
  const seen = new Set<number>();
  payload.goal.targets.forEach((target, targetIndex) => {
    if (target.index >= cellCount) {
      context.addIssue({
        code: "custom",
        path: ["goal", "targets", targetIndex, "index"],
        message: "target cell is outside the puzzle",
      });
    } else if (payload.puzzle[target.index] !== 0) {
      context.addIssue({
        code: "custom",
        path: ["goal", "targets", targetIndex, "index"],
        message: "target cell must be empty in the prototype",
      });
    }
    if (target.value > variant.size) {
      context.addIssue({
        code: "custom",
        path: ["goal", "targets", targetIndex, "value"],
        message: `target value must be between 1 and ${variant.size}`,
      });
    }
    if (seen.has(target.index)) {
      context.addIssue({
        code: "custom",
        path: ["goal", "targets", targetIndex, "index"],
        message: "target cells must be unique",
      });
    }
    seen.add(target.index);
  });
});

export type SudokuAuthoredPayload = z.infer<typeof sudokuAuthoredPayloadSchema>;
export type SudokuActivityPayload = z.infer<typeof sudokuActivityPayloadSchema>;
export type SudokuCoursewarePayload = SudokuAuthoredPayload | SudokuActivityPayload;
export type SudokuActivityGoal = z.infer<typeof sudokuActivityGoalSchema>;
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

export function createDefaultSudokuActivityPayload(
  variantId: SudokuVariantId = DEFAULT_SUDOKU_VARIANT_ID,
): SudokuActivityPayload {
  const variant = getSudokuVariant(variantId);
  if (!variant) throw new Error(`Unknown Sudoku variant: ${variantId}`);
  return {
    kind: "authored-activity",
    variantId,
    puzzle: Array.from({ length: variant.size * variant.size }, () => 0),
    goal: { kind: "teacher-led" },
    display: {
      showCoordinates: true,
      allowCandidates: true,
      allowAnswerReveal: false,
      showTeachingTools: true,
    },
  };
}

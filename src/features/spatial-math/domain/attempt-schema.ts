import { z } from "zod";
import { canonicalFingerprint64, canonicalJsonStringify } from "./canonical-json";
import { rationalSchema } from "./exact";
import { voxelCoordinateSchema } from "./voxel-schema";
import { SPATIAL_VOXEL_LIMITS } from "./voxel-types";

export const SPATIAL_ATTEMPT_VERSION = "spatial-attempt-v1" as const;
export const SPATIAL_ATTEMPT_EVALUATION_VERSION = "spatial-attempt-evaluation-v1" as const;

export const SPATIAL_ATTEMPT_LIMITS = {
  maxBytes: 256 * 1_024,
  maxExplanationLength: 2_000,
  maxAttempts: 10,
  maxSelectedEntities: 256,
} as const;

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
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "invalid sha256");

export const spatialAttemptResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("numeric"), value: rationalSchema }).strict(),
  z.object({ kind: z.literal("choice"), optionIds: z.array(stableIdSchema).min(1).max(8) }).strict(),
  z
    .object({
      kind: z.literal("entity-selection"),
      entityIds: z.array(stableIdSchema).min(1).max(SPATIAL_ATTEMPT_LIMITS.maxSelectedEntities),
    })
    .strict(),
  z
    .object({
      kind: z.literal("voxel-selection"),
      entityId: stableIdSchema,
      cells: z.array(voxelCoordinateSchema).max(SPATIAL_VOXEL_LIMITS.maxCells),
    })
    .strict(),
  z
    .object({
      kind: z.literal("explanation"),
      text: z
        .string()
        .min(1)
        .max(SPATIAL_ATTEMPT_LIMITS.maxExplanationLength)
        .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value), "control characters are not allowed"),
    })
    .strict(),
]);

export const spatialAttemptBindingSchema = z
  .object({
    sessionId: stableIdSchema,
    pageDocId: stableIdSchema,
    studentId: stableIdSchema,
    currentResetEpoch: z.number().int().min(0).max(1_000_000_000),
    runtimeStateHash: sha256Schema,
    nextAttemptNo: z.number().int().min(1).max(SPATIAL_ATTEMPT_LIMITS.maxAttempts),
  })
  .strict();

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCoordinates(
  left: { readonly x: number; readonly y: number; readonly z: number },
  right: { readonly x: number; readonly y: number; readonly z: number },
): number {
  return left.x - right.x || left.y - right.y || left.z - right.z;
}

function addStableSetIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  path: (string | number)[],
  label: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) context.addIssue({ code: "custom", message: `duplicate ${label}: ${value}`, path: [...path, index] });
    seen.add(value);
    if (index > 0 && compareStableStrings(values[index - 1], value) > 0) {
      context.addIssue({ code: "custom", message: `${label} must use stable order`, path });
    }
  });
}

export const spatialAttemptSchema = z
  .object({
    attemptVersion: z.literal(SPATIAL_ATTEMPT_VERSION),
    attemptId: stableIdSchema,
    idempotencyKey: stableIdSchema,
    sceneRevisionHash: sha256Schema,
    checkpointId: stableIdSchema,
    context: z
      .object({
        sessionId: stableIdSchema,
        pageDocId: stableIdSchema,
        studentId: stableIdSchema,
        resetEpoch: z.number().int().min(0).max(1_000_000_000),
        runtimeStateHash: sha256Schema,
        attemptNo: z.number().int().min(1).max(SPATIAL_ATTEMPT_LIMITS.maxAttempts),
      })
      .strict(),
    submittedAt: z.string().datetime({ offset: true }),
    response: spatialAttemptResponseSchema,
  })
  .strict()
  .superRefine((attempt, context) => {
    if (attempt.response.kind === "choice") {
      addStableSetIssues(attempt.response.optionIds, context, ["response", "optionIds"], "choice option id");
    }
    if (attempt.response.kind === "entity-selection") {
      addStableSetIssues(attempt.response.entityIds, context, ["response", "entityIds"], "entity id");
    }
    if (attempt.response.kind === "voxel-selection") {
      const cells = attempt.response.cells;
      const seen = new Set<string>();
      cells.forEach((cell, index) => {
        const key = `${cell.x},${cell.y},${cell.z}`;
        if (seen.has(key)) context.addIssue({ code: "custom", message: `duplicate voxel coordinate: ${key}`, path: ["response", "cells", index] });
        seen.add(key);
        if (index > 0 && compareCoordinates(cells[index - 1], cell) > 0) {
          context.addIssue({ code: "custom", message: "voxel cells must use stable coordinate order", path: ["response", "cells"] });
        }
      });
    }
    const bytes = new TextEncoder().encode(canonicalJsonStringify(attempt)).byteLength;
    if (bytes > SPATIAL_ATTEMPT_LIMITS.maxBytes) {
      context.addIssue({ code: "custom", message: `attempt size ${bytes} exceeds limit`, path: [] });
    }
  });

export const spatialAttemptEvaluationSchema = z
  .object({
    evaluationVersion: z.literal(SPATIAL_ATTEMPT_EVALUATION_VERSION),
    attemptId: stableIdSchema,
    attemptFingerprint: z.string().regex(/^[0-9a-f]{16}$/),
    sceneRevisionHash: sha256Schema,
    checkpointId: stableIdSchema,
    authority: z.literal("server-pinned-kernel"),
    kernelVersion: semanticTokenSchema,
    outcome: z.enum(["correct", "incorrect", "collected", "not-evaluated"]),
    reason: z.enum(["MATCH", "MISMATCH", "COLLECTED", "UNSUPPORTED_EVALUATOR"]),
  })
  .strict();

export type SpatialAttemptResponse = z.infer<typeof spatialAttemptResponseSchema>;
export type SpatialAttemptBinding = z.infer<typeof spatialAttemptBindingSchema>;
export type SpatialAttempt = z.infer<typeof spatialAttemptSchema>;
export type SpatialAttemptEvaluation = z.infer<typeof spatialAttemptEvaluationSchema>;

export function parseSpatialAttempt(input: unknown): SpatialAttempt {
  return spatialAttemptSchema.parse(input);
}

export function parseSpatialAttemptBinding(input: unknown): SpatialAttemptBinding {
  return spatialAttemptBindingSchema.parse(input);
}

export function parseSpatialAttemptEvaluation(input: unknown): SpatialAttemptEvaluation {
  return spatialAttemptEvaluationSchema.parse(input);
}

export function spatialAttemptFingerprint(attemptInput: unknown): string {
  return canonicalFingerprint64(parseSpatialAttempt(attemptInput));
}

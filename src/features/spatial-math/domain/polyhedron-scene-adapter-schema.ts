import { z } from "zod";
import { positiveRationalSchema } from "./exact";
import { polyhedronFoldSimulationRequestSchema } from "./polyhedron-fold-simulation-schema";
import {
  polyhedronGeometrySchema,
  polyhedronNetLayoutSchema,
} from "./polyhedron-net-geometry-schema";
import {
  polyhedronHingeGraphSchema,
  polyhedronTopologySchema,
} from "./polyhedron-topology-schema";
import { localizedTextSchema } from "./scene-schema";

export const POLYHEDRON_SCENE_ADAPTER_VERSION = "polyhedron-scene-adapter-v1" as const;

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

const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scratch") }).strict(),
  z.object({ kind: z.literal("preset"), sourceId: stableIdSchema, releaseNo: z.number().int().positive() }).strict(),
  z
    .object({ kind: z.literal("activity-release"), sourceId: stableIdSchema, releaseNo: z.number().int().positive() })
    .strict(),
]);

const faceLabelSchema = z.object({ faceId: stableIdSchema, label: localizedTextSchema }).strict();

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function addStableOrderIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  path: (string | number)[],
  label: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) context.addIssue({ code: "custom", message: `duplicate ${label}: ${value}`, path: [...path, index] });
    seen.add(value);
    if (index > 0 && compareIds(values[index - 1], value) > 0) {
      context.addIssue({ code: "custom", message: `${label} must use stable order`, path });
    }
  });
}

export const polyhedronSceneAdapterInputSchema = z
  .object({
    adapterVersion: z.literal(POLYHEDRON_SCENE_ADAPTER_VERSION),
    sceneId: stableIdSchema,
    entityId: stableIdSchema,
    title: localizedTextSchema,
    entityLabel: localizedTextSchema,
    localePolicy: z.enum(["bilingual", "zh-content-with-en-fallback"]),
    learning: z
      .object({
        learningGoal: localizedTextSchema,
        termIds: z.array(stableIdSchema).max(32),
        prerequisiteTermIds: z.array(stableIdSchema).max(32),
        misconceptions: z.array(localizedTextSchema).max(16),
        teacherPrompts: z.array(localizedTextSchema).max(32),
      })
      .strict(),
    appearance: z
      .object({
        materialToken: semanticTokenSchema,
        background: z.enum(["paper", "night"]),
        lighting: z.enum(["flat", "soft"]),
      })
      .strict(),
    space: z
      .object({
        unit: z.enum(["unit", "mm", "cm", "m"]),
        gridStep: positiveRationalSchema,
      })
      .strict(),
    topology: polyhedronTopologySchema,
    geometry: polyhedronGeometrySchema,
    hingeGraph: polyhedronHingeGraphSchema,
    layout: polyhedronNetLayoutSchema,
    simulationRequest: polyhedronFoldSimulationRequestSchema,
    faceLabels: z.array(faceLabelSchema).min(4).max(64),
    teaching: z
      .object({
        referenceFaceId: stableIdSchema,
        optionFaceIds: z.array(stableIdSchema).min(2).max(8),
        checkpointId: stableIdSchema,
        checkpointPrompt: localizedTextSchema,
        revealPolicy: z.enum(["never", "after-submit", "teacher"]),
        fallbackSummary: localizedTextSchema,
        orthographicSummaries: z
          .object({
            front: localizedTextSchema,
            right: localizedTextSchema,
            top: localizedTextSchema,
          })
          .strict(),
      })
      .strict(),
    provenance: z
      .object({
        source: sourceSchema,
        createdBy: stableIdSchema,
        createdAt: z.string().datetime({ offset: true }),
        minRuntimeVersion: z.string().regex(/^\d+\.\d+\.\d+$/, "runtime version must be semver"),
      })
      .strict(),
  })
  .strict()
  .superRefine((input, context) => {
    addStableOrderIssues(input.learning.termIds, context, ["learning", "termIds"], "term id");
    addStableOrderIssues(
      input.learning.prerequisiteTermIds,
      context,
      ["learning", "prerequisiteTermIds"],
      "prerequisite term id",
    );
    addStableOrderIssues(input.faceLabels.map((face) => face.faceId), context, ["faceLabels"], "face label id");
    addStableOrderIssues(input.teaching.optionFaceIds, context, ["teaching", "optionFaceIds"], "option face id");
  });

export type PolyhedronSceneAdapterInput = z.infer<typeof polyhedronSceneAdapterInputSchema>;

export function parsePolyhedronSceneAdapterInput(input: unknown): PolyhedronSceneAdapterInput {
  return polyhedronSceneAdapterInputSchema.parse(input);
}

import { z } from "zod";
import { canonicalJsonStringify } from "../domain/canonical-json";
import { localizedTextSchema } from "../domain/scene-schema";
import {
  analyzeSurfacePaint,
  analyzeVoxelSurfaceArea,
  connectedVoxelComponents,
  countVoxelLayers,
  createVoxelSet,
  findEnclosedVoxelCavities,
  projectVoxels,
} from "../domain";
import {
  compareVoxelCoordinates,
  voxelCoordinateListSchema,
} from "../domain/voxel-schema";
import { AXES, FACE_DIRECTIONS, ORTHOGRAPHIC_VIEWS } from "../domain/voxel-types";

export const SPATIAL_GOLD_REVIEW_STATUS = "engineering-candidate" as const;

const stableIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const nonNegativeIntegerSchema = z.number().int().nonnegative();
const layerExpectationSchema = z
  .object({ coordinate: z.number().int(), count: nonNegativeIntegerSchema })
  .strict();

const paintHistogramSchema = z.tuple([
  nonNegativeIntegerSchema,
  nonNegativeIntegerSchema,
  nonNegativeIntegerSchema,
  nonNegativeIntegerSchema,
  nonNegativeIntegerSchema,
  nonNegativeIntegerSchema,
  nonNegativeIntegerSchema,
]);

export const spatialGoldAssertionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("voxel-count"), expected: nonNegativeIntegerSchema }).strict(),
  z
    .object({
      kind: z.literal("layer-counts"),
      axis: z.enum(AXES),
      expected: z.array(layerExpectationSchema),
    })
    .strict(),
  z
    .object({
      kind: z.literal("projection"),
      view: z.enum(ORTHOGRAPHIC_VIEWS),
      expected: z
        .object({
          visibleVoxelCount: nonNegativeIntegerSchema,
          hiddenVoxelCount: nonNegativeIntegerSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("surface-area"),
      expected: z
        .object({
          totalUnitFaces: nonNegativeIntegerSchema,
          exteriorUnitFaces: nonNegativeIntegerSchema,
          interiorUnitFaces: nonNegativeIntegerSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("cavity-volumes"),
      expected: z.array(z.number().int().positive()),
    })
    .strict(),
  z.object({ kind: z.literal("component-count"), expected: z.number().int().positive() }).strict(),
  z
    .object({
      kind: z.literal("paint-histogram"),
      exposure: z.enum(["exterior-only", "all-boundary"]),
      directions: z.array(z.enum(FACE_DIRECTIONS)).min(1).max(6),
      expected: z
        .object({
          paintedUnitFaces: nonNegativeIntegerSchema,
          histogram: paintHistogramSchema,
        })
        .strict(),
    })
    .strict(),
]);

export const spatialGoldCaseSchema = z
  .object({
    id: stableIdSchema,
    reviewStatus: z.literal(SPATIAL_GOLD_REVIEW_STATUS),
    title: localizedTextSchema,
    capability: z.enum(["P1", "P2", "P3", "P5"]),
    problemFamily: z.enum([
      "view",
      "layer-count",
      "hidden-count",
      "paint",
      "hollow",
      "surface-volume",
    ]),
    termIds: z.array(stableIdSchema).min(1).max(8),
    prompt: localizedTextSchema,
    misconception: localizedTextSchema,
    teacherPrompt: localizedTextSchema,
    cells: voxelCoordinateListSchema,
    assertions: z.array(spatialGoldAssertionSchema).min(3).max(12),
  })
  .strict()
  .superRefine((goldCase, context) => {
    const issue = (message: string, path: (string | number)[]) =>
      context.addIssue({ code: "custom", message, path });
    const uniqueTerms = new Set(goldCase.termIds);
    if (uniqueTerms.size !== goldCase.termIds.length) issue("duplicate term id", ["termIds"]);
    if (goldCase.termIds.some((term, index) => index > 0 && goldCase.termIds[index - 1] > term)) {
      issue("term ids must use stable order", ["termIds"]);
    }
    if (
      goldCase.cells.some(
        (cell, index) => index > 0 && compareVoxelCoordinates(goldCase.cells[index - 1], cell) > 0,
      )
    ) {
      issue("cells must use stable coordinate order", ["cells"]);
    }

    const assertionKeys = goldCase.assertions.map((assertion) => {
      if (assertion.kind === "projection") return `${assertion.kind}:${assertion.view}`;
      if (assertion.kind === "layer-counts") return `${assertion.kind}:${assertion.axis}`;
      if (assertion.kind === "paint-histogram") {
        return `${assertion.kind}:${assertion.exposure}:${assertion.directions.join(",")}`;
      }
      return assertion.kind;
    });
    if (new Set(assertionKeys).size !== assertionKeys.length) issue("duplicate assertion", ["assertions"]);

    for (const required of ["voxel-count", "projection:front", "surface-area"]) {
      if (!assertionKeys.includes(required)) issue(`missing required assertion: ${required}`, ["assertions"]);
    }

    goldCase.assertions.forEach((assertion, index) => {
      const path = ["assertions", index] as (string | number)[];
      if (assertion.kind === "voxel-count" && assertion.expected !== goldCase.cells.length) {
        issue("voxel count expectation must match authored cells", [...path, "expected"]);
      }
      if (assertion.kind === "projection") {
        if (assertion.expected.visibleVoxelCount + assertion.expected.hiddenVoxelCount !== goldCase.cells.length) {
          issue("projection counts must account for every voxel", [...path, "expected"]);
        }
      }
      if (assertion.kind === "layer-counts") {
        if (assertion.expected.reduce((sum, layer) => sum + layer.count, 0) !== goldCase.cells.length) {
          issue("layer counts must account for every voxel", [...path, "expected"]);
        }
        if (
          assertion.expected.some(
            (layer, layerIndex) =>
              layerIndex > 0 && assertion.expected[layerIndex - 1].coordinate >= layer.coordinate,
          )
        ) {
          issue("layer coordinates must use strict ascending order", [...path, "expected"]);
        }
      }
      if (assertion.kind === "surface-area") {
        if (
          assertion.expected.exteriorUnitFaces + assertion.expected.interiorUnitFaces !==
          assertion.expected.totalUnitFaces
        ) {
          issue("exterior and interior surfaces must sum to total surface", [...path, "expected"]);
        }
      }
      if (assertion.kind === "cavity-volumes") {
        if (assertion.expected.some((volume, cavityIndex) => cavityIndex > 0 && assertion.expected[cavityIndex - 1] > volume)) {
          issue("cavity volumes must use ascending order", [...path, "expected"]);
        }
      }
      if (assertion.kind === "paint-histogram") {
        if (new Set(assertion.directions).size !== assertion.directions.length) {
          issue("paint directions must be unique", [...path, "directions"]);
        }
        const directionOrder = new Map(FACE_DIRECTIONS.map((direction, directionIndex) => [direction, directionIndex]));
        if (
          assertion.directions.some(
            (direction, directionIndex) =>
              directionIndex > 0 &&
              (directionOrder.get(assertion.directions[directionIndex - 1]) ?? -1) >
                (directionOrder.get(direction) ?? -1),
          )
        ) {
          issue("paint directions must use stable order", [...path, "directions"]);
        }
        if (assertion.expected.histogram.reduce((sum, count) => sum + count, 0) !== goldCase.cells.length) {
          issue("paint histogram must account for every voxel", [...path, "expected", "histogram"]);
        }
      }
    });
  });

export const spatialGoldCaseSetSchema = z
  .array(spatialGoldCaseSchema)
  .length(20)
  .superRefine((cases, context) => {
    const ids = cases.map((goldCase) => goldCase.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "gold case ids must be unique" });
    }
    if (ids.some((id, index) => index > 0 && ids[index - 1] > id)) {
      context.addIssue({ code: "custom", message: "gold cases must use stable id order" });
    }
  });

export type SpatialGoldCase = z.infer<typeof spatialGoldCaseSchema>;
export type SpatialGoldAssertion = z.infer<typeof spatialGoldAssertionSchema>;

export interface SpatialGoldAssertionResult {
  readonly assertion: SpatialGoldAssertion;
  readonly actual: unknown;
  readonly pass: boolean;
}

function actualForAssertion(
  voxels: ReturnType<typeof createVoxelSet>,
  assertion: SpatialGoldAssertion,
): unknown {
  switch (assertion.kind) {
    case "voxel-count":
      return voxels.size;
    case "layer-counts":
      return countVoxelLayers(voxels, assertion.axis);
    case "projection": {
      const projection = projectVoxels(voxels, assertion.view);
      return {
        visibleVoxelCount: projection.visibleVoxelCount,
        hiddenVoxelCount: projection.hiddenVoxelCount,
      };
    }
    case "surface-area":
      return analyzeVoxelSurfaceArea(voxels);
    case "cavity-volumes":
      return findEnclosedVoxelCavities(voxels)
        .map((cavity) => cavity.volumeInUnitCubes)
        .sort((left, right) => left - right);
    case "component-count":
      return connectedVoxelComponents(voxels).length;
    case "paint-histogram": {
      const paint = analyzeSurfacePaint(voxels, {
        exposure: assertion.exposure,
        directions: assertion.directions,
      });
      return { paintedUnitFaces: paint.paintedUnitFaces, histogram: paint.histogram };
    }
  }
}

function expectedForAssertion(assertion: SpatialGoldAssertion): unknown {
  return assertion.expected;
}

export function evaluateSpatialGoldCase(goldCase: SpatialGoldCase): readonly SpatialGoldAssertionResult[] {
  const parsed = spatialGoldCaseSchema.parse(goldCase);
  const voxels = createVoxelSet(parsed.cells);
  return parsed.assertions.map((assertion) => {
    const actual = actualForAssertion(voxels, assertion);
    return {
      assertion,
      actual,
      pass: canonicalJsonStringify(actual) === canonicalJsonStringify(expectedForAssertion(assertion)),
    };
  });
}

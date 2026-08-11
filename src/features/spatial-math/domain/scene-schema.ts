import { z } from "zod";
import { canonicalJsonStringify } from "./canonical-json";
import {
  compareRationals,
  exactVector3Schema,
  finiteVector3Schema,
  positiveRationalSchema,
  rationalSchema,
  type Rational,
} from "./exact";
import {
  compareVoxelCoordinates,
  voxelCoordinateSchema,
  voxelKey,
} from "./voxel-schema";
import {
  AXES,
  FACE_DIRECTIONS,
  ORTHOGRAPHIC_VIEWS,
  SPATIAL_VOXEL_LIMITS,
} from "./voxel-types";
import { polyhedronFoldArtifactSchema } from "./polyhedron-fold-artifact-schema";

export const SPATIAL_SCENE_VERSION = "spatial-scene-v1" as const;

export const SPATIAL_SCENE_LIMITS = {
  maxBytes: 512 * 1_024,
  maxEntities: 256,
  maxParameters: 64,
  maxCameraBookmarks: 24,
  maxLayers: 100,
  maxSteps: 200,
  maxActionsPerStep: 100,
  maxCheckpoints: 100,
  maxFormulas: 64,
  maxExpressionNodes: 256,
  maxExpressionDepth: 32,
  maxActionVoxels: 512,
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

const plainTextSchema = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !/<\/?[A-Za-z][^>]*>/.test(value), "HTML markup is not allowed");

export const localizedTextSchema = z
  .object({
    zh: plainTextSchema(2_000),
    en: plainTextSchema(2_000).optional(),
  })
  .strict();

const unitSchema = z.enum(["unit", "mm", "cm", "m", "ml", "l"]);

const voxelCellSchema = voxelCoordinateSchema.extend({
  id: stableIdSchema,
  materialToken: semanticTokenSchema.optional(),
});

const voxelSetEntitySchema = z
  .object({
    id: stableIdSchema,
    type: z.literal("voxel-set"),
    label: localizedTextSchema.optional(),
    visible: z.boolean(),
    materialToken: semanticTokenSchema,
    cells: z.array(voxelCellSchema).max(SPATIAL_VOXEL_LIMITS.maxCells),
  })
  .strict();

const axialPrimitiveShape = {
  radius: positiveRationalSchema,
  height: positiveRationalSchema,
  axis: z.enum(AXES),
};

const primitiveDefinitionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cube"), edge: positiveRationalSchema }).strict(),
  z
    .object({
      kind: z.literal("cuboid"),
      width: positiveRationalSchema,
      height: positiveRationalSchema,
      depth: positiveRationalSchema,
    })
    .strict(),
  z.object({ kind: z.literal("cylinder"), ...axialPrimitiveShape }).strict(),
  z.object({ kind: z.literal("cone"), ...axialPrimitiveShape }).strict(),
  z.object({ kind: z.literal("sphere"), radius: positiveRationalSchema }).strict(),
  z
    .object({
      kind: z.literal("prism"),
      baseSides: z.number().int().min(3).max(12),
      circumradius: positiveRationalSchema,
      height: positiveRationalSchema,
      axis: z.enum(AXES),
    })
    .strict(),
  z
    .object({
      kind: z.literal("pyramid"),
      baseSides: z.number().int().min(3).max(12),
      circumradius: positiveRationalSchema,
      height: positiveRationalSchema,
      axis: z.enum(AXES),
    })
    .strict(),
]);

const primitiveEntitySchema = z
  .object({
    id: stableIdSchema,
    type: z.literal("primitive"),
    label: localizedTextSchema.optional(),
    visible: z.boolean(),
    materialToken: semanticTokenSchema,
    origin: exactVector3Schema,
    orientationQuarterTurns: z
      .object({ x: z.number().int().min(0).max(3), y: z.number().int().min(0).max(3), z: z.number().int().min(0).max(3) })
      .strict(),
    definition: primitiveDefinitionSchema,
  })
  .strict();

const polyhedronVertexSchema = z
  .object({ id: stableIdSchema, position: exactVector3Schema })
  .strict();

const polyhedronFaceSchema = z
  .object({
    id: stableIdSchema,
    vertexIds: z.array(stableIdSchema).min(3).max(64),
    materialToken: semanticTokenSchema.optional(),
  })
  .strict();

const polyhedronEntitySchema = z
  .object({
    id: stableIdSchema,
    type: z.literal("polyhedron"),
    label: localizedTextSchema.optional(),
    visible: z.boolean(),
    materialToken: semanticTokenSchema,
    vertices: z.array(polyhedronVertexSchema).min(4).max(512),
    faces: z.array(polyhedronFaceSchema).min(4).max(512),
    folding: polyhedronFoldArtifactSchema.optional(),
  })
  .strict();

const guideDefinitionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("axis"), axis: z.enum(AXES) }).strict(),
  z
    .object({
      kind: z.literal("grid"),
      plane: z.enum(["xy", "xz", "yz"]),
      minU: z.number().int().min(-1_024).max(1_024),
      maxU: z.number().int().min(-1_024).max(1_024),
      minV: z.number().int().min(-1_024).max(1_024),
      maxV: z.number().int().min(-1_024).max(1_024),
    })
    .strict(),
  z
    .object({ kind: z.literal("plane"), normal: exactVector3Schema, constant: rationalSchema })
    .strict(),
]);

const guideEntitySchema = z
  .object({
    id: stableIdSchema,
    type: z.literal("guide"),
    label: localizedTextSchema.optional(),
    visible: z.boolean(),
    materialToken: semanticTokenSchema,
    definition: guideDefinitionSchema,
  })
  .strict();

const labelEntitySchema = z
  .object({
    id: stableIdSchema,
    type: z.literal("label"),
    visible: z.boolean(),
    anchor: exactVector3Schema,
    text: localizedTextSchema,
  })
  .strict();

export const spatialEntitySchema = z.discriminatedUnion("type", [
  voxelSetEntitySchema,
  primitiveEntitySchema,
  polyhedronEntitySchema,
  guideEntitySchema,
  labelEntitySchema,
]);

const sceneParameterSchema = z
  .object({
    id: stableIdSchema,
    label: localizedTextSchema,
    unit: unitSchema,
    initial: rationalSchema,
    min: rationalSchema,
    max: rationalSchema,
    step: positiveRationalSchema,
  })
  .strict();

const orthographicCameraSchema = z
  .object({
    id: stableIdSchema,
    label: localizedTextSchema,
    projection: z.literal("orthographic"),
    position: finiteVector3Schema,
    target: finiteVector3Schema,
    up: finiteVector3Schema,
    zoom: z.number().finite().min(0.01).max(100),
  })
  .strict();

const perspectiveCameraSchema = z
  .object({
    id: stableIdSchema,
    label: localizedTextSchema,
    projection: z.literal("perspective"),
    position: finiteVector3Schema,
    target: finiteVector3Schema,
    up: finiteVector3Schema,
    fovDegrees: z.number().finite().min(10).max(100),
  })
  .strict();

const cameraBookmarkSchema = z.discriminatedUnion("projection", [
  orthographicCameraSchema,
  perspectiveCameraSchema,
]);

const layerSelectorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("entities"), entityIds: z.array(stableIdSchema).min(1).max(256) }).strict(),
  z
    .object({
      kind: z.literal("voxel-axis-range"),
      entityId: stableIdSchema,
      axis: z.enum(AXES),
      min: z.number().int().min(-1_024).max(1_024),
      max: z.number().int().min(-1_024).max(1_024),
    })
    .strict(),
]);

const presentationLayerSchema = z
  .object({
    id: stableIdSchema,
    label: localizedTextSchema,
    initiallyVisible: z.boolean(),
    selector: layerSelectorSchema,
  })
  .strict();

const actionVoxelListSchema = z.array(voxelCoordinateSchema).max(SPATIAL_SCENE_LIMITS.maxActionVoxels);

export const spatialSceneActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("camera.apply"), cameraId: stableIdSchema }).strict(),
  z.object({ kind: z.literal("layer.set"), layerId: stableIdSchema, visible: z.boolean() }).strict(),
  z
    .object({ kind: z.literal("entity.visibility.set"), entityIds: z.array(stableIdSchema).min(1).max(256), visible: z.boolean() })
    .strict(),
  z.object({ kind: z.literal("entity.select"), entityIds: z.array(stableIdSchema).max(256) }).strict(),
  z.object({ kind: z.literal("voxel.add"), entityId: stableIdSchema, cells: actionVoxelListSchema }).strict(),
  z.object({ kind: z.literal("voxel.remove"), entityId: stableIdSchema, cells: actionVoxelListSchema }).strict(),
  z
    .object({
      kind: z.literal("voxel.paint"),
      entityId: stableIdSchema,
      cells: actionVoxelListSchema,
      directions: z.array(z.enum(FACE_DIRECTIONS)).min(1).max(6),
      materialToken: semanticTokenSchema,
    })
    .strict(),
  z.object({ kind: z.literal("net.foldTo"), entityId: stableIdSchema, progress: z.number().finite().min(0).max(1) }).strict(),
  z
    .object({
      kind: z.literal("section.plane.set"),
      planeGuideId: stableIdSchema,
      targetEntityId: stableIdSchema,
      normal: exactVector3Schema,
      constant: rationalSchema,
    })
    .strict(),
  z.object({ kind: z.literal("parameter.set"), parameterId: stableIdSchema, value: rationalSchema }).strict(),
  z.object({ kind: z.literal("scene.reset") }).strict(),
]);

export type SpatialSceneAction = z.infer<typeof spatialSceneActionSchema>;

const sceneStepSchema = z
  .object({
    id: stableIdSchema,
    title: localizedTextSchema.optional(),
    teacherPrompt: localizedTextSchema.optional(),
    announce: localizedTextSchema.optional(),
    transition: z.enum(["none", "linear", "ease-in-out"]),
    durationMs: z.number().int().min(0).max(30_000),
    actions: z.array(spatialSceneActionSchema).max(SPATIAL_SCENE_LIMITS.maxActionsPerStep),
  })
  .strict();

const derivedVoxelQuerySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("voxel.total"), entityId: stableIdSchema }).strict(),
  z
    .object({ kind: z.literal("voxel.layer-count"), entityId: stableIdSchema, axis: z.enum(AXES), coordinate: z.number().int().min(-1_024).max(1_024) })
    .strict(),
  z.object({ kind: z.literal("voxel.hidden-count"), entityId: stableIdSchema, view: z.enum(ORTHOGRAPHIC_VIEWS) }).strict(),
  z
    .object({
      kind: z.literal("voxel.surface-area"),
      entityId: stableIdSchema,
      surface: z.enum(["total", "exterior", "interior"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("voxel.paint-category"),
      entityId: stableIdSchema,
      paintedFaceCount: z.number().int().min(0).max(6),
      exposure: z.enum(["exterior-only", "all-boundary"]),
      directions: z.array(z.enum(FACE_DIRECTIONS)).min(1).max(6),
    })
    .strict(),
  z.object({ kind: z.literal("voxel.cavity-volume"), entityId: stableIdSchema }).strict(),
]);

const numericEvaluatorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("derived"), query: derivedVoxelQuerySchema }).strict(),
  z.object({ kind: z.literal("exact"), value: rationalSchema }).strict(),
  z.object({ kind: z.literal("formula"), formulaId: stableIdSchema }).strict(),
]);

const checkpointBaseShape = {
  id: stableIdSchema,
  prompt: localizedTextSchema,
  revealPolicy: z.enum(["never", "after-submit", "teacher"]),
};

const numericCheckpointSchema = z
  .object({
    ...checkpointBaseShape,
    type: z.literal("numeric"),
    responseFormat: z.enum(["integer", "rational"]),
    evaluator: numericEvaluatorSchema,
  })
  .strict();

const choiceOptionSchema = z.object({ id: stableIdSchema, label: localizedTextSchema }).strict();

const choiceCheckpointSchema = z
  .object({
    ...checkpointBaseShape,
    type: z.literal("choice"),
    multiple: z.boolean(),
    options: z.array(choiceOptionSchema).min(2).max(8),
    correctOptionIds: z.array(stableIdSchema).min(1).max(8),
  })
  .strict();

const entitySelectionCheckpointSchema = z
  .object({
    ...checkpointBaseShape,
    type: z.literal("entity-selection"),
    expectedEntityIds: z.array(stableIdSchema).min(1).max(256),
  })
  .strict();

const voxelSelectionCheckpointSchema = z
  .object({
    ...checkpointBaseShape,
    type: z.literal("voxel-selection"),
    entityId: stableIdSchema,
    expectedCells: z.array(voxelCoordinateSchema).max(SPATIAL_VOXEL_LIMITS.maxCells),
  })
  .strict();

const explanationCheckpointSchema = z
  .object({
    ...checkpointBaseShape,
    type: z.literal("explanation"),
    minLength: z.number().int().min(0).max(2_000),
    maxLength: z.number().int().min(1).max(2_000),
  })
  .strict();

export const spatialCheckpointSchema = z.discriminatedUnion("type", [
  numericCheckpointSchema,
  choiceCheckpointSchema,
  entitySelectionCheckpointSchema,
  voxelSelectionCheckpointSchema,
  explanationCheckpointSchema,
]);

export type SpatialExpression =
  | { readonly kind: "constant"; readonly value: Rational }
  | { readonly kind: "parameter"; readonly parameterId: string }
  | { readonly kind: "measure"; readonly entityId: string; readonly measure: "volume" | "surface-area" | "length" | "area" }
  | { readonly kind: "binary"; readonly operator: "+" | "-" | "*" | "/"; readonly left: SpatialExpression; readonly right: SpatialExpression }
  | { readonly kind: "power"; readonly base: SpatialExpression; readonly exponent: number };

function createSpatialExpressionSchema(depth: number): z.ZodType<SpatialExpression> {
  const constant = z.object({ kind: z.literal("constant"), value: rationalSchema }).strict();
  const parameter = z.object({ kind: z.literal("parameter"), parameterId: stableIdSchema }).strict();
  const measure = z
    .object({
      kind: z.literal("measure"),
      entityId: stableIdSchema,
      measure: z.enum(["volume", "surface-area", "length", "area"]),
    })
    .strict();

  if (depth >= SPATIAL_SCENE_LIMITS.maxExpressionDepth) {
    return z.discriminatedUnion("kind", [constant, parameter, measure]) as z.ZodType<SpatialExpression>;
  }

  const child = createSpatialExpressionSchema(depth + 1);
  const binary = z
    .object({
      kind: z.literal("binary"),
      operator: z.enum(["+", "-", "*", "/"]),
      left: child,
      right: child,
    })
    .strict();
  const power = z
    .object({
      kind: z.literal("power"),
      base: child,
      exponent: z.number().int().min(-8).max(8),
    })
    .strict();
  return z.discriminatedUnion("kind", [constant, parameter, measure, binary, power]) as z.ZodType<SpatialExpression>;
}

export const spatialExpressionSchema = createSpatialExpressionSchema(1);

const formulaBindingSchema = z
  .object({
    id: stableIdSchema,
    label: localizedTextSchema,
    expression: spatialExpressionSchema,
    unit: unitSchema,
    displaySteps: z.array(localizedTextSchema).max(32),
  })
  .strict();

const accessibilitySchema = z
  .object({
    summary: localizedTextSchema,
    orthographicViews: z
      .array(
        z
          .object({ view: z.enum(["front", "right", "top"]), summary: localizedTextSchema })
          .strict(),
      )
      .length(3),
    layerTable: z.object({ enabled: z.boolean(), axis: z.enum(AXES).optional() }).strict(),
    measurementTable: z.boolean(),
    objectDescriptions: z
      .array(z.object({ entityId: stableIdSchema, description: localizedTextSchema }).strict())
      .max(SPATIAL_SCENE_LIMITS.maxEntities),
    keyboardOrder: z.array(stableIdSchema).max(SPATIAL_SCENE_LIMITS.maxEntities),
    colorLegend: z
      .array(
        z
          .object({ materialToken: semanticTokenSchema, label: localizedTextSchema, pattern: z.enum(["solid", "dots", "stripes", "crosshatch"]) })
          .strict(),
      )
      .max(64),
  })
  .strict();

const provenanceSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scratch") }).strict(),
  z.object({ kind: z.literal("preset"), sourceId: stableIdSchema, releaseNo: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("activity-release"), sourceId: stableIdSchema, releaseNo: z.number().int().positive() }).strict(),
]);

function vectorsEqual(
  left: { readonly x: number; readonly y: number; readonly z: number },
  right: { readonly x: number; readonly y: number; readonly z: number },
): boolean {
  return left.x === right.x && left.y === right.y && left.z === right.z;
}

function exactVectorIsZero(vector: { readonly x: Rational; readonly y: Rational; readonly z: Rational }): boolean {
  return vector.x.numerator === 0 && vector.y.numerator === 0 && vector.z.numerator === 0;
}

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function expressionStats(expression: SpatialExpression): { nodes: number; depth: number } {
  if (expression.kind === "binary") {
    const left = expressionStats(expression.left);
    const right = expressionStats(expression.right);
    return { nodes: 1 + left.nodes + right.nodes, depth: 1 + Math.max(left.depth, right.depth) };
  }
  if (expression.kind === "power") {
    const base = expressionStats(expression.base);
    return { nodes: 1 + base.nodes, depth: 1 + base.depth };
  }
  return { nodes: 1, depth: 1 };
}

export const spatialSceneSchema = z
  .object({
    schemaVersion: z.literal(SPATIAL_SCENE_VERSION),
    sceneId: stableIdSchema,
    title: localizedTextSchema,
    localePolicy: z.enum(["bilingual", "zh-content-with-en-fallback"]),
    learning: z
      .object({
        capability: z.enum(["P0", "P1", "P2", "P3", "P4", "P5", "M1", "M2"]),
        learningGoal: localizedTextSchema,
        termIds: z.array(stableIdSchema).max(32),
        prerequisiteTermIds: z.array(stableIdSchema).max(32),
        misconceptions: z.array(localizedTextSchema).max(16),
        teacherPrompts: z.array(localizedTextSchema).max(32),
      })
      .strict(),
    space: z
      .object({
        coordinateSystem: z.literal("right-handed-y-up"),
        unit: unitSchema,
        gridStep: positiveRationalSchema,
      })
      .strict(),
    model: z
      .object({
        entities: z.array(spatialEntitySchema).max(SPATIAL_SCENE_LIMITS.maxEntities),
        parameters: z.array(sceneParameterSchema).max(SPATIAL_SCENE_LIMITS.maxParameters),
      })
      .strict(),
    presentation: z
      .object({
        background: z.enum(["paper", "night"]),
        lighting: z.enum(["flat", "soft"]),
        showEdges: z.boolean(),
        showAxes: z.boolean(),
        cameraBookmarks: z.array(cameraBookmarkSchema).min(1).max(SPATIAL_SCENE_LIMITS.maxCameraBookmarks),
        defaultCameraId: stableIdSchema,
        layers: z.array(presentationLayerSchema).max(SPATIAL_SCENE_LIMITS.maxLayers),
      })
      .strict(),
    sequence: z
      .object({
        initialStepId: stableIdSchema.optional(),
        steps: z.array(sceneStepSchema).max(SPATIAL_SCENE_LIMITS.maxSteps),
      })
      .strict(),
    checkpoints: z.array(spatialCheckpointSchema).max(SPATIAL_SCENE_LIMITS.maxCheckpoints),
    formulas: z.array(formulaBindingSchema).max(SPATIAL_SCENE_LIMITS.maxFormulas),
    accessibility: accessibilitySchema,
    provenance: z
      .object({
        source: provenanceSourceSchema,
        createdBy: stableIdSchema,
        createdAt: z.string().datetime({ offset: true }),
        kernelVersion: semanticTokenSchema,
        minRuntimeVersion: z.string().regex(/^\d+\.\d+\.\d+$/, "runtime version must be semver"),
      })
      .strict(),
  })
  .strict()
  .superRefine((scene, context) => {
    const addIssue = (message: string, path: (string | number)[]) =>
      context.addIssue({ code: "custom", message, path });
    const ensureUnique = (values: readonly string[], path: (string | number)[], label: string) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value)) addIssue(`duplicate ${label}: ${value}`, [...path, index]);
        seen.add(value);
      });
    };
    const ensureSorted = (values: readonly string[], path: (string | number)[], label: string) => {
      if (values.some((value, index) => index > 0 && compareStableStrings(values[index - 1], value) > 0)) {
        addIssue(`${label} must use stable ascending order`, path);
      }
    };
    const ensureVoxelOrder = (
      cells: readonly { readonly x: number; readonly y: number; readonly z: number }[],
      path: (string | number)[],
    ) => {
      if (cells.some((cell, index) => index > 0 && compareVoxelCoordinates(cells[index - 1], cell) > 0)) {
        addIssue("voxel coordinates must use stable order", path);
      }
    };
    const ensureFaceDirectionOrder = (directions: readonly string[], path: (string | number)[]) => {
      const order = new Map(FACE_DIRECTIONS.map((direction, index) => [direction, index]));
      if (
        directions.some(
          (direction, index) =>
            index > 0 && (order.get(directions[index - 1] as (typeof FACE_DIRECTIONS)[number]) ?? -1) > (order.get(direction as (typeof FACE_DIRECTIONS)[number]) ?? -1),
        )
      ) {
        addIssue("face directions must use stable order", path);
      }
    };
    const requireEntity = (id: string, path: (string | number)[], expectedType?: string) => {
      const entity = entityById.get(id);
      if (!entity) addIssue(`unknown entity: ${id}`, path);
      else if (expectedType && entity.type !== expectedType) {
        addIssue(`entity ${id} must be ${expectedType}`, path);
      }
    };

    ensureUnique(scene.learning.termIds, ["learning", "termIds"], "term id");
    ensureSorted(scene.learning.termIds, ["learning", "termIds"], "term ids");
    ensureUnique(scene.learning.prerequisiteTermIds, ["learning", "prerequisiteTermIds"], "term id");
    ensureSorted(scene.learning.prerequisiteTermIds, ["learning", "prerequisiteTermIds"], "prerequisite term ids");

    const entityIds = scene.model.entities.map((entity) => entity.id);
    ensureUnique(entityIds, ["model", "entities"], "entity id");
    ensureSorted(entityIds, ["model", "entities"], "entities");
    const entityById = new Map(scene.model.entities.map((entity) => [entity.id, entity]));
    let totalVoxels = 0;

    scene.model.entities.forEach((entity, entityIndex) => {
      if (entity.type === "voxel-set") {
        totalVoxels += entity.cells.length;
        ensureUnique(entity.cells.map((cell) => cell.id), ["model", "entities", entityIndex, "cells"], "cell id");
        ensureUnique(entity.cells.map(voxelKey), ["model", "entities", entityIndex, "cells"], "voxel coordinate");
        if (
          entity.cells.some((cell, index) => {
            if (index === 0) return false;
            const previous = entity.cells[index - 1];
            return compareVoxelCoordinates(previous, cell) > 0 ||
              (compareVoxelCoordinates(previous, cell) === 0 && compareStableStrings(previous.id, cell.id) > 0);
          })
        ) {
          addIssue("voxel cells must use stable coordinate order", ["model", "entities", entityIndex, "cells"]);
        }
      }

      if (entity.type === "polyhedron") {
        const vertexIds = entity.vertices.map((vertex) => vertex.id);
        const faceIds = entity.faces.map((face) => face.id);
        ensureUnique(vertexIds, ["model", "entities", entityIndex, "vertices"], "vertex id");
        ensureSorted(vertexIds, ["model", "entities", entityIndex, "vertices"], "vertices");
        ensureUnique(faceIds, ["model", "entities", entityIndex, "faces"], "face id");
        ensureSorted(faceIds, ["model", "entities", entityIndex, "faces"], "faces");
        const vertexSet = new Set(vertexIds);
        entity.faces.forEach((face, faceIndex) => {
          ensureUnique(face.vertexIds, ["model", "entities", entityIndex, "faces", faceIndex, "vertexIds"], "face vertex id");
          face.vertexIds.forEach((vertexId, vertexIndex) => {
            if (!vertexSet.has(vertexId)) {
              addIssue(`unknown polyhedron vertex: ${vertexId}`, ["model", "entities", entityIndex, "faces", faceIndex, "vertexIds", vertexIndex]);
            }
          });
        });
        if (entity.folding) {
          const geometryVertices = entity.folding.geometry.vertices;
          if (
            entity.vertices.length !== geometryVertices.length ||
            entity.vertices.some((vertex, index) => {
              const geometryVertex = geometryVertices[index];
              return (
                vertex.id !== geometryVertex?.vertexId ||
                canonicalJsonStringify(vertex.position) !== canonicalJsonStringify(geometryVertex.position)
              );
            })
          ) {
            addIssue("polyhedron vertices must match folding geometry", ["model", "entities", entityIndex, "folding", "geometry"]);
          }
          const topologyFaces = entity.folding.topology.faces;
          if (
            entity.faces.length !== topologyFaces.length ||
            entity.faces.some((face, index) => {
              const topologyFace = topologyFaces[index];
              return face.id !== topologyFace?.id || face.vertexIds.join("|") !== topologyFace.vertexIds.join("|");
            })
          ) {
            addIssue("polyhedron faces must match folding topology", ["model", "entities", entityIndex, "folding", "topology"]);
          }
        }
      }

      if (entity.type === "guide") {
        const definition = entity.definition;
        if (definition.kind === "grid" && (definition.minU > definition.maxU || definition.minV > definition.maxV)) {
          addIssue("grid minimum must not exceed maximum", ["model", "entities", entityIndex, "definition"]);
        }
        if (definition.kind === "plane" && exactVectorIsZero(definition.normal)) {
          addIssue("plane normal must be non-zero", ["model", "entities", entityIndex, "definition", "normal"]);
        }
      }
    });
    if (totalVoxels > SPATIAL_VOXEL_LIMITS.maxCells) {
      addIssue(`scene exceeds ${SPATIAL_VOXEL_LIMITS.maxCells} occupied voxels`, ["model", "entities"]);
    }

    const parameterIds = scene.model.parameters.map((parameter) => parameter.id);
    ensureUnique(parameterIds, ["model", "parameters"], "parameter id");
    ensureSorted(parameterIds, ["model", "parameters"], "parameters");
    const parameterSet = new Set(parameterIds);
    scene.model.parameters.forEach((parameter, index) => {
      if (compareRationals(parameter.min, parameter.initial) > 0 || compareRationals(parameter.initial, parameter.max) > 0) {
        addIssue("parameter initial value must be within min/max", ["model", "parameters", index, "initial"]);
      }
    });

    const cameraIds = scene.presentation.cameraBookmarks.map((camera) => camera.id);
    ensureUnique(cameraIds, ["presentation", "cameraBookmarks"], "camera id");
    ensureSorted(cameraIds, ["presentation", "cameraBookmarks"], "camera bookmarks");
    const cameraSet = new Set(cameraIds);
    if (!cameraSet.has(scene.presentation.defaultCameraId)) {
      addIssue("default camera does not exist", ["presentation", "defaultCameraId"]);
    }
    scene.presentation.cameraBookmarks.forEach((camera, index) => {
      if (vectorsEqual(camera.position, camera.target)) {
        addIssue("camera position must differ from target", ["presentation", "cameraBookmarks", index, "position"]);
      }
      if (camera.up.x === 0 && camera.up.y === 0 && camera.up.z === 0) {
        addIssue("camera up vector must be non-zero", ["presentation", "cameraBookmarks", index, "up"]);
      }
    });

    const layerIds = scene.presentation.layers.map((layer) => layer.id);
    ensureUnique(layerIds, ["presentation", "layers"], "layer id");
    ensureSorted(layerIds, ["presentation", "layers"], "layers");
    const layerSet = new Set(layerIds);
    scene.presentation.layers.forEach((layer, index) => {
      if (layer.selector.kind === "entities") {
        ensureUnique(layer.selector.entityIds, ["presentation", "layers", index, "selector", "entityIds"], "entity id");
        ensureSorted(layer.selector.entityIds, ["presentation", "layers", index, "selector", "entityIds"], "layer entity ids");
        layer.selector.entityIds.forEach((id, entityIndex) =>
          requireEntity(id, ["presentation", "layers", index, "selector", "entityIds", entityIndex]),
        );
      } else {
        requireEntity(layer.selector.entityId, ["presentation", "layers", index, "selector", "entityId"], "voxel-set");
        if (layer.selector.min > layer.selector.max) {
          addIssue("layer minimum must not exceed maximum", ["presentation", "layers", index, "selector"]);
        }
      }
    });

    const stepIds = scene.sequence.steps.map((step) => step.id);
    ensureUnique(stepIds, ["sequence", "steps"], "step id");
    if (scene.sequence.initialStepId && !stepIds.includes(scene.sequence.initialStepId)) {
      addIssue("initial step does not exist", ["sequence", "initialStepId"]);
    }
    scene.sequence.steps.forEach((step, stepIndex) => {
      step.actions.forEach((action, actionIndex) => {
        const path = ["sequence", "steps", stepIndex, "actions", actionIndex] as (string | number)[];
        if (action.kind === "camera.apply" && !cameraSet.has(action.cameraId)) addIssue(`unknown camera: ${action.cameraId}`, [...path, "cameraId"]);
        if (action.kind === "layer.set" && !layerSet.has(action.layerId)) addIssue(`unknown layer: ${action.layerId}`, [...path, "layerId"]);
        if (action.kind === "entity.visibility.set" || action.kind === "entity.select") {
          ensureUnique(action.entityIds, [...path, "entityIds"], "entity id");
          ensureSorted(action.entityIds, [...path, "entityIds"], "action entity ids");
          action.entityIds.forEach((id, index) => requireEntity(id, [...path, "entityIds", index]));
        }
        if (action.kind === "voxel.add" || action.kind === "voxel.remove" || action.kind === "voxel.paint") {
          requireEntity(action.entityId, [...path, "entityId"], "voxel-set");
          ensureUnique(action.cells.map(voxelKey), [...path, "cells"], "voxel coordinate");
          ensureVoxelOrder(action.cells, [...path, "cells"]);
        }
        if (action.kind === "voxel.paint") {
          ensureUnique(action.directions, [...path, "directions"], "face direction");
          ensureFaceDirectionOrder(action.directions, [...path, "directions"]);
        }
        if (action.kind === "net.foldTo") requireEntity(action.entityId, [...path, "entityId"], "polyhedron");
        if (action.kind === "section.plane.set") {
          requireEntity(action.targetEntityId, [...path, "targetEntityId"]);
          requireEntity(action.planeGuideId, [...path, "planeGuideId"], "guide");
          const guide = entityById.get(action.planeGuideId);
          if (guide?.type === "guide" && guide.definition.kind !== "plane") {
            addIssue("section guide must define a plane", [...path, "planeGuideId"]);
          }
          if (exactVectorIsZero(action.normal)) addIssue("section normal must be non-zero", [...path, "normal"]);
        }
        if (action.kind === "parameter.set" && !parameterSet.has(action.parameterId)) {
          addIssue(`unknown parameter: ${action.parameterId}`, [...path, "parameterId"]);
        }
      });
    });

    const formulaIds = scene.formulas.map((formula) => formula.id);
    ensureUnique(formulaIds, ["formulas"], "formula id");
    ensureSorted(formulaIds, ["formulas"], "formulas");
    const formulaSet = new Set(formulaIds);
    const validateExpression = (expression: SpatialExpression, path: (string | number)[]) => {
      if (expression.kind === "parameter" && !parameterSet.has(expression.parameterId)) {
        addIssue(`unknown parameter: ${expression.parameterId}`, [...path, "parameterId"]);
      }
      if (expression.kind === "measure") requireEntity(expression.entityId, [...path, "entityId"]);
      if (expression.kind === "binary") {
        validateExpression(expression.left, [...path, "left"]);
        validateExpression(expression.right, [...path, "right"]);
      }
      if (expression.kind === "power") validateExpression(expression.base, [...path, "base"]);
    };
    scene.formulas.forEach((formula, index) => {
      const stats = expressionStats(formula.expression);
      if (stats.nodes > SPATIAL_SCENE_LIMITS.maxExpressionNodes) {
        addIssue("expression exceeds node limit", ["formulas", index, "expression"]);
      }
      if (stats.depth > SPATIAL_SCENE_LIMITS.maxExpressionDepth) {
        addIssue("expression exceeds depth limit", ["formulas", index, "expression"]);
      }
      validateExpression(formula.expression, ["formulas", index, "expression"]);
    });

    const checkpointIds = scene.checkpoints.map((checkpoint) => checkpoint.id);
    ensureUnique(checkpointIds, ["checkpoints"], "checkpoint id");
    scene.checkpoints.forEach((checkpoint, index) => {
      const path = ["checkpoints", index] as (string | number)[];
      if (checkpoint.type === "numeric") {
        if (checkpoint.evaluator.kind === "formula" && !formulaSet.has(checkpoint.evaluator.formulaId)) {
          addIssue(`unknown formula: ${checkpoint.evaluator.formulaId}`, [...path, "evaluator", "formulaId"]);
        }
        if (checkpoint.evaluator.kind === "derived") {
          requireEntity(checkpoint.evaluator.query.entityId, [...path, "evaluator", "query", "entityId"], "voxel-set");
          if (checkpoint.evaluator.query.kind === "voxel.paint-category") {
            ensureUnique(checkpoint.evaluator.query.directions, [...path, "evaluator", "query", "directions"], "face direction");
            ensureFaceDirectionOrder(checkpoint.evaluator.query.directions, [...path, "evaluator", "query", "directions"]);
          }
        }
      }
      if (checkpoint.type === "choice") {
        const optionIds = checkpoint.options.map((option) => option.id);
        ensureUnique(optionIds, [...path, "options"], "choice option id");
        ensureUnique(checkpoint.correctOptionIds, [...path, "correctOptionIds"], "correct option id");
        ensureSorted(checkpoint.correctOptionIds, [...path, "correctOptionIds"], "correct option ids");
        checkpoint.correctOptionIds.forEach((id, optionIndex) => {
          if (!optionIds.includes(id)) addIssue(`unknown choice option: ${id}`, [...path, "correctOptionIds", optionIndex]);
        });
        if (!checkpoint.multiple && checkpoint.correctOptionIds.length !== 1) {
          addIssue("single choice must have exactly one correct option", [...path, "correctOptionIds"]);
        }
      }
      if (checkpoint.type === "entity-selection") {
        ensureUnique(checkpoint.expectedEntityIds, [...path, "expectedEntityIds"], "entity id");
        ensureSorted(checkpoint.expectedEntityIds, [...path, "expectedEntityIds"], "expected entity ids");
        checkpoint.expectedEntityIds.forEach((id, entityIndex) => requireEntity(id, [...path, "expectedEntityIds", entityIndex]));
      }
      if (checkpoint.type === "voxel-selection") {
        requireEntity(checkpoint.entityId, [...path, "entityId"], "voxel-set");
        ensureUnique(checkpoint.expectedCells.map(voxelKey), [...path, "expectedCells"], "voxel coordinate");
        ensureVoxelOrder(checkpoint.expectedCells, [...path, "expectedCells"]);
      }
      if (checkpoint.type === "explanation" && checkpoint.minLength > checkpoint.maxLength) {
        addIssue("minimum explanation length exceeds maximum", [...path, "minLength"]);
      }
    });

    const accessibilityViews = scene.accessibility.orthographicViews.map((view) => view.view);
    ensureUnique(accessibilityViews, ["accessibility", "orthographicViews"], "orthographic view");
    if (accessibilityViews.join(",") !== "front,right,top") {
      addIssue("accessibility views must use front, right, top order", ["accessibility", "orthographicViews"]);
    }
    for (const requiredView of ["front", "right", "top"] as const) {
      if (!accessibilityViews.includes(requiredView)) {
        addIssue(`missing accessibility view: ${requiredView}`, ["accessibility", "orthographicViews"]);
      }
    }
    ensureUnique(scene.accessibility.keyboardOrder, ["accessibility", "keyboardOrder"], "keyboard entity id");
    scene.accessibility.keyboardOrder.forEach((id, index) => requireEntity(id, ["accessibility", "keyboardOrder", index]));
    const describedEntityIds = scene.accessibility.objectDescriptions.map((description) => description.entityId);
    ensureUnique(describedEntityIds, ["accessibility", "objectDescriptions"], "described entity id");
    ensureSorted(describedEntityIds, ["accessibility", "objectDescriptions"], "object descriptions");
    describedEntityIds.forEach((id, index) => requireEntity(id, ["accessibility", "objectDescriptions", index, "entityId"]));
    const legendTokens = scene.accessibility.colorLegend.map((entry) => entry.materialToken);
    ensureUnique(legendTokens, ["accessibility", "colorLegend"], "legend material token");
    ensureSorted(legendTokens, ["accessibility", "colorLegend"], "color legend");

    const bytes = new TextEncoder().encode(canonicalJsonStringify(scene)).byteLength;
    if (bytes > SPATIAL_SCENE_LIMITS.maxBytes) {
      addIssue(`scene size ${bytes} exceeds ${SPATIAL_SCENE_LIMITS.maxBytes} bytes`, []);
    }
  });

export type SpatialScene = z.infer<typeof spatialSceneSchema>;

export function parseSpatialScene(input: unknown): SpatialScene {
  return spatialSceneSchema.parse(input);
}

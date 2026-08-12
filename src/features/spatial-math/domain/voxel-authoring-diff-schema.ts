import { z } from "zod";
import { canonicalJsonStringify } from "./canonical-json";
import { localizedTextSchema, SPATIAL_SCENE_LIMITS } from "./scene-schema";
import {
  VOXEL_AUTHORING_DRAFT_LIMITS,
  VOXEL_AUTHORING_DRAFT_VERSION,
} from "./voxel-authoring-draft-schema";
import {
  VOXEL_LESSON_CAMERAS,
  VOXEL_LESSON_LIMITS,
  voxelLessonLayerTitleSchema,
  voxelLessonStepSchema,
} from "./voxel-lesson-schema";
import {
  compareVoxelCoordinates,
  voxelCoordinateSchema,
  voxelKey,
} from "./voxel-schema";
import { AXES, SPATIAL_VOXEL_LIMITS } from "./voxel-types";

export const VOXEL_AUTHORING_DIFF_VERSION = "voxel-authoring-diff-v1" as const;

const AUTHORING_DIFF_STRUCTURAL_OVERHEAD_BYTES = 512 * 1_024;

export const VOXEL_AUTHORING_DIFF_LIMITS = {
  sourceDraftBytesPerSide: VOXEL_AUTHORING_DRAFT_LIMITS.maxBytes,
  sourceSceneBytesPerSide: SPATIAL_SCENE_LIMITS.maxBytes,
  structuralOverheadBytes: AUTHORING_DIFF_STRUCTURAL_OVERHEAD_BYTES,
  // Authored values occur at most once per source draft, while derived layer
  // values occur at most once per compiled scene. The extra 512 KiB covers all
  // bounded wrapper keys, indexes, hashes and compact voxel-math summaries.
  maxBytes:
    2 * VOXEL_AUTHORING_DRAFT_LIMITS.maxBytes +
    2 * SPATIAL_SCENE_LIMITS.maxBytes +
    AUTHORING_DIFF_STRUCTURAL_OVERHEAD_BYTES,
  maxCellChangesPerSide: SPATIAL_VOXEL_LIMITS.maxCells,
  maxStepChanges: VOXEL_LESSON_LIMITS.maxLogicalSteps,
  maxLayerStepsPerSide: SPATIAL_SCENE_LIMITS.maxLayers,
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
const stepIndexSchema = z.number().int().min(0).max(VOXEL_LESSON_LIMITS.maxLogicalSteps - 1);

function changedValueSchema<T extends z.ZodType>(valueSchema: T) {
  return z
    .object({ before: valueSchema, after: valueSchema })
    .strict()
    .superRefine((change, context) => {
      const values = change as { readonly before: unknown; readonly after: unknown };
      if (canonicalJsonStringify(values.before) === canonicalJsonStringify(values.after)) {
        context.addIssue({ code: "custom", message: "change must have distinct before and after values", path: [] });
      }
    });
}

const localizedChangeSchema = changedValueSchema(localizedTextSchema);
const optionalLocalizedChangeSchema = changedValueSchema(localizedTextSchema.nullable());
const booleanChangeSchema = changedValueSchema(z.boolean());
const submissionChangeSchema = changedValueSchema(z.number().int().min(1).max(10));
const cameraChangeSchema = changedValueSchema(z.enum(VOXEL_LESSON_CAMERAS));
const layerOrderChangeSchema = changedValueSchema(z.enum(["ascending", "descending"]));
const layerTitleChangeSchema = changedValueSchema(voxelLessonLayerTitleSchema);

const modelScalarChangeSchema = z
  .union([
    z.object({ field: z.literal("sceneId"), before: stableIdSchema, after: stableIdSchema }).strict(),
    z.object({ field: z.literal("entityId"), before: stableIdSchema, after: stableIdSchema }).strict(),
    z.object({ field: z.literal("layerAxis"), before: z.enum(AXES), after: z.enum(AXES) }).strict(),
    z.object({ field: z.literal("materialToken"), before: semanticTokenSchema, after: semanticTokenSchema }).strict(),
    z.object({ field: z.literal("createdBy"), before: stableIdSchema, after: stableIdSchema }).strict(),
    z
      .object({
        field: z.literal("createdAt"),
        before: z.string().datetime({ offset: true }),
        after: z.string().datetime({ offset: true }),
      })
      .strict(),
  ])
  .superRefine((change, context) => {
    if (change.before === change.after) {
      context.addIssue({ code: "custom", message: "scalar change must have distinct values", path: [] });
    }
  });

const modelLocalizedChangeSchema = z
  .object({
    field: z.enum(["title", "learningGoal", "misconception"]),
    before: localizedTextSchema,
    after: localizedTextSchema,
  })
  .strict()
  .superRefine((change, context) => {
    if (canonicalJsonStringify(change.before) === canonicalJsonStringify(change.after)) {
      context.addIssue({ code: "custom", message: "localized change must have distinct values", path: [] });
    }
  });

const referenceSetDiffSchema = z
  .object({
    added: z.array(stableIdSchema).max(32),
    removed: z.array(stableIdSchema).max(32),
  })
  .strict();

const indexedLessonStepSchema = z
  .object({ index: stepIndexSchema, step: voxelLessonStepSchema })
  .strict();

const movedLessonStepSchema = z
  .object({
    stepId: stableIdSchema,
    beforeIndex: stepIndexSchema,
    afterIndex: stepIndexSchema,
    beforeCommonIndex: stepIndexSchema,
    afterCommonIndex: stepIndexSchema,
  })
  .strict()
  .superRefine((change, context) => {
    if (change.beforeCommonIndex === change.afterCommonIndex) {
      context.addIssue({ code: "custom", message: "moved step must change common-step index", path: [] });
    }
  });

const commonStepChangeShape = {
  stepId: stableIdSchema,
  teacherPrompt: optionalLocalizedChangeSchema.optional(),
};

const lessonStepChangeSchema = z
  .discriminatedUnion("kind", [
    z.object({ ...commonStepChangeShape, kind: z.literal("predict"), title: localizedChangeSchema.optional() }).strict(),
    z.object({ ...commonStepChangeShape, kind: z.literal("view"), camera: cameraChangeSchema.optional(), title: localizedChangeSchema.optional() }).strict(),
    z
      .object({
        ...commonStepChangeShape,
        kind: z.literal("layer-scan"),
        order: layerOrderChangeSchema.optional(),
        title: layerTitleChangeSchema.optional(),
      })
      .strict(),
    z.object({ ...commonStepChangeShape, kind: z.literal("verify"), title: localizedChangeSchema.optional() }).strict(),
  ])
  .superRefine((change, context) => {
    const changedFields = Object.keys(change).filter((key) => key !== "stepId" && key !== "kind");
    if (changedFields.length === 0) {
      context.addIssue({ code: "custom", message: "step change must contain a changed field", path: [] });
    }
  });

const checkpointDiffSchema = z
  .object({
    prompt: localizedChangeSchema.optional(),
    required: booleanChangeSchema.optional(),
    maxSubmissions: submissionChangeSchema.optional(),
  })
  .strict();

const layerStepSnapshotSchema = z
  .object({
    playbackIndex: z.number().int().min(0).max(SPATIAL_SCENE_LIMITS.maxSteps - 1),
    sceneStepId: stableIdSchema,
    layerId: stableIdSchema,
    axis: z.enum(AXES),
    coordinate: z.number().int().min(SPATIAL_VOXEL_LIMITS.minCoordinate).max(SPATIAL_VOXEL_LIMITS.maxCoordinate),
    canonicalOrdinal: z.number().int().min(1).max(SPATIAL_SCENE_LIMITS.maxLayers),
    title: localizedTextSchema,
    teacherPrompt: localizedTextSchema.optional(),
  })
  .strict();

const layerStepSequenceSchema = z
  .array(layerStepSnapshotSchema)
  .min(1)
  .max(VOXEL_AUTHORING_DIFF_LIMITS.maxLayerStepsPerSide)
  .superRefine((steps, context) => {
    const sceneStepIds = new Set<string>();
    const layerIds = new Set<string>();
    const axes = new Set<string>();
    const coordinates = new Set<number>();
    const canonicalOrdinals = new Set<number>();
    steps.forEach((step, index) => {
      if (step.playbackIndex !== index) {
        context.addIssue({ code: "custom", message: "layer playback indexes must be contiguous", path: [index, "playbackIndex"] });
      }
      if (sceneStepIds.has(step.sceneStepId)) {
        context.addIssue({ code: "custom", message: `duplicate derived scene step id: ${step.sceneStepId}`, path: [index, "sceneStepId"] });
      }
      if (layerIds.has(step.layerId)) {
        context.addIssue({ code: "custom", message: `duplicate derived layer id: ${step.layerId}`, path: [index, "layerId"] });
      }
      sceneStepIds.add(step.sceneStepId);
      layerIds.add(step.layerId);
      axes.add(step.axis);
      if (coordinates.has(step.coordinate)) {
        context.addIssue({ code: "custom", message: `duplicate derived layer coordinate: ${step.coordinate}`, path: [index, "coordinate"] });
      }
      if (canonicalOrdinals.has(step.canonicalOrdinal)) {
        context.addIssue({ code: "custom", message: `duplicate derived layer ordinal: ${step.canonicalOrdinal}`, path: [index, "canonicalOrdinal"] });
      }
      coordinates.add(step.coordinate);
      canonicalOrdinals.add(step.canonicalOrdinal);
    });
    if (axes.size !== 1) {
      context.addIssue({ code: "custom", message: "derived layer steps must use one axis", path: [] });
    }
    const canonical = [...steps].sort(
      (left, right) => left.canonicalOrdinal - right.canonicalOrdinal,
    );
    canonical.forEach((step, index) => {
      if (step.canonicalOrdinal !== index + 1) {
        context.addIssue({ code: "custom", message: "derived layer ordinals must be contiguous", path: [] });
      }
      if (index > 0 && canonical[index - 1].coordinate >= step.coordinate) {
        context.addIssue({ code: "custom", message: "canonical layer coordinates must be ascending", path: [] });
      }
    });
    const ascendingPlayback = steps.every(
      (step, index) => step.canonicalOrdinal === index + 1,
    );
    const descendingPlayback = steps.every(
      (step, index) => step.canonicalOrdinal === steps.length - index,
    );
    if (!ascendingPlayback && !descendingPlayback) {
      context.addIssue({ code: "custom", message: "derived layer playback must be ascending or descending", path: [] });
    }
  });

const sourceHashesSchema = z
  .object({ draftHash: sha256Schema, sceneHash: sha256Schema, pageHash: sha256Schema })
  .strict();

const layerCountSchema = z
  .object({
    coordinate: z.number().int().min(SPATIAL_VOXEL_LIMITS.minCoordinate).max(SPATIAL_VOXEL_LIMITS.maxCoordinate),
    count: z.number().int().min(0).max(SPATIAL_VOXEL_LIMITS.maxCells),
  })
  .strict();

const projectionBoundsSchema = z
  .object({
    minU: z.number().int().min(SPATIAL_VOXEL_LIMITS.minCoordinate).max(SPATIAL_VOXEL_LIMITS.maxCoordinate),
    maxU: z.number().int().min(SPATIAL_VOXEL_LIMITS.minCoordinate).max(SPATIAL_VOXEL_LIMITS.maxCoordinate),
    minV: z.number().int().min(SPATIAL_VOXEL_LIMITS.minCoordinate).max(SPATIAL_VOXEL_LIMITS.maxCoordinate),
    maxV: z.number().int().min(SPATIAL_VOXEL_LIMITS.minCoordinate).max(SPATIAL_VOXEL_LIMITS.maxCoordinate),
  })
  .strict()
  .superRefine((bounds, context) => {
    if (bounds.minU > bounds.maxU || bounds.minV > bounds.maxV) {
      context.addIssue({ code: "custom", message: "projection bounds must be ordered", path: [] });
    }
  });

function projectionSummarySchema<View extends "front" | "right" | "top">(view: View) {
  return z
    .object({
      view: z.literal(view),
      visibleVoxelCount: z.number().int().min(1).max(SPATIAL_VOXEL_LIMITS.maxCells),
      hiddenVoxelCount: z.number().int().min(0).max(SPATIAL_VOXEL_LIMITS.maxCells - 1),
      shapeFingerprint: sha256Schema,
      bounds: projectionBoundsSchema,
    })
    .strict();
}

const voxelMathSummarySchema = z
  .object({
    totalCount: z.number().int().min(1).max(SPATIAL_VOXEL_LIMITS.maxCells),
    layerAxis: z.enum(AXES),
    layerCounts: z.array(layerCountSchema).min(1).max(SPATIAL_SCENE_LIMITS.maxLayers),
    projections: z.tuple([
      projectionSummarySchema("front"),
      projectionSummarySchema("right"),
      projectionSummarySchema("top"),
    ]),
  })
  .strict()
  .superRefine((summary, context) => {
    const layerTotal = summary.layerCounts.reduce((total, layer) => total + layer.count, 0);
    if (layerTotal !== summary.totalCount) {
      context.addIssue({ code: "custom", message: "layer counts must sum to totalCount", path: ["layerCounts"] });
    }
    summary.layerCounts.forEach((layer, index) => {
      if (index > 0 && summary.layerCounts[index - 1].coordinate >= layer.coordinate) {
        context.addIssue({ code: "custom", message: "layer counts must use ascending unique coordinates", path: ["layerCounts", index, "coordinate"] });
      }
    });
    summary.projections.forEach((projection, index) => {
      if (projection.visibleVoxelCount + projection.hiddenVoxelCount !== summary.totalCount) {
        context.addIssue({ code: "custom", message: "projection visible and hidden counts must sum to totalCount", path: ["projections", index] });
      }
    });
  });

const SCALAR_FIELD_ORDER = ["sceneId", "entityId", "layerAxis", "materialToken", "createdBy", "createdAt"] as const;
const LOCALIZED_FIELD_ORDER = ["title", "learningGoal", "misconception"] as const;

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function addStableOrderIssues<T>(
  values: readonly T[],
  keyOf: (value: T) => string,
  context: z.RefinementCtx,
  path: (string | number)[],
  label: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const key = keyOf(value);
    if (seen.has(key)) {
      context.addIssue({ code: "custom", message: `duplicate ${label}: ${key}`, path: [...path, index] });
    }
    if (index > 0 && compareStableStrings(keyOf(values[index - 1]), key) > 0) {
      context.addIssue({ code: "custom", message: `${label} must use stable order`, path });
    }
    seen.add(key);
  });
}

function addCoordinateOrderIssues(
  cells: readonly z.infer<typeof voxelCoordinateSchema>[],
  context: z.RefinementCtx,
  path: (string | number)[],
): void {
  const seen = new Set<string>();
  cells.forEach((cell, index) => {
    const key = voxelKey(cell);
    if (seen.has(key)) {
      context.addIssue({ code: "custom", message: `duplicate changed voxel: ${key}`, path: [...path, index] });
    }
    if (index > 0 && compareVoxelCoordinates(cells[index - 1], cell) > 0) {
      context.addIssue({ code: "custom", message: "changed voxels must use stable coordinate order", path });
    }
    seen.add(key);
  });
}

export const voxelAuthoringDiffSchema = z
  .object({
    diffVersion: z.literal(VOXEL_AUTHORING_DIFF_VERSION),
    draftVersion: z.literal(VOXEL_AUTHORING_DRAFT_VERSION),
    before: sourceHashesSchema,
    after: sourceHashesSchema,
    authored: z
      .object({
        model: z
          .object({
            cellsAdded: z.array(voxelCoordinateSchema).max(VOXEL_AUTHORING_DIFF_LIMITS.maxCellChangesPerSide),
            cellsRemoved: z.array(voxelCoordinateSchema).max(VOXEL_AUTHORING_DIFF_LIMITS.maxCellChangesPerSide),
            scalarChanges: z.array(modelScalarChangeSchema).max(SCALAR_FIELD_ORDER.length),
            localizedChanges: z.array(modelLocalizedChangeSchema).max(LOCALIZED_FIELD_ORDER.length),
            termIds: referenceSetDiffSchema,
            prerequisiteTermIds: referenceSetDiffSchema,
          })
          .strict(),
        lesson: z
          .object({
            stepsAdded: z.array(indexedLessonStepSchema).max(VOXEL_AUTHORING_DIFF_LIMITS.maxStepChanges),
            stepsRemoved: z.array(indexedLessonStepSchema).max(VOXEL_AUTHORING_DIFF_LIMITS.maxStepChanges),
            stepsMoved: z.array(movedLessonStepSchema).max(VOXEL_AUTHORING_DIFF_LIMITS.maxStepChanges),
            stepsChanged: z.array(lessonStepChangeSchema).max(VOXEL_AUTHORING_DIFF_LIMITS.maxStepChanges),
            checkpoint: checkpointDiffSchema,
          })
          .strict(),
      })
      .strict(),
    derived: z
      .object({
        voxelMath: z
          .object({
            changed: z.boolean(),
            before: voxelMathSummarySchema,
            after: voxelMathSummarySchema,
          })
          .strict()
          .optional(),
        layerSteps: z
          .object({
            changed: z.boolean(),
            before: layerStepSequenceSchema,
            after: layerStepSequenceSchema,
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((diff, context) => {
    const model = diff.authored.model;
    const lesson = diff.authored.lesson;
    addCoordinateOrderIssues(model.cellsAdded, context, ["authored", "model", "cellsAdded"]);
    addCoordinateOrderIssues(model.cellsRemoved, context, ["authored", "model", "cellsRemoved"]);
    const removedCellKeys = new Set(model.cellsRemoved.map(voxelKey));
    model.cellsAdded.forEach((cell, index) => {
      if (removedCellKeys.has(voxelKey(cell))) {
        context.addIssue({ code: "custom", message: "a voxel cannot be both added and removed", path: ["authored", "model", "cellsAdded", index] });
      }
    });

    const scalarRank = new Map(SCALAR_FIELD_ORDER.map((field, index) => [field, index]));
    model.scalarChanges.forEach((change, index) => {
      if (index > 0 && (scalarRank.get(model.scalarChanges[index - 1].field) ?? -1) >= (scalarRank.get(change.field) ?? -1)) {
        context.addIssue({ code: "custom", message: "model scalar changes must use fixed field order", path: ["authored", "model", "scalarChanges"] });
      }
    });
    const localizedRank = new Map(LOCALIZED_FIELD_ORDER.map((field, index) => [field, index]));
    model.localizedChanges.forEach((change, index) => {
      if (index > 0 && (localizedRank.get(model.localizedChanges[index - 1].field) ?? -1) >= (localizedRank.get(change.field) ?? -1)) {
        context.addIssue({ code: "custom", message: "model localized changes must use fixed field order", path: ["authored", "model", "localizedChanges"] });
      }
    });

    for (const field of ["termIds", "prerequisiteTermIds"] as const) {
      const changes = model[field];
      addStableOrderIssues(changes.added, (value) => value, context, ["authored", "model", field, "added"], `${field} addition`);
      addStableOrderIssues(changes.removed, (value) => value, context, ["authored", "model", field, "removed"], `${field} removal`);
      const removed = new Set(changes.removed);
      changes.added.forEach((value, index) => {
        if (removed.has(value)) {
          context.addIssue({ code: "custom", message: `${field} cannot add and remove the same id`, path: ["authored", "model", field, "added", index] });
        }
      });
    }

    addStableOrderIssues(lesson.stepsAdded, (entry) => entry.step.id, context, ["authored", "lesson", "stepsAdded"], "added lesson step");
    addStableOrderIssues(lesson.stepsRemoved, (entry) => entry.step.id, context, ["authored", "lesson", "stepsRemoved"], "removed lesson step");
    addStableOrderIssues(lesson.stepsMoved, (entry) => entry.stepId, context, ["authored", "lesson", "stepsMoved"], "moved lesson step");
    addStableOrderIssues(lesson.stepsChanged, (entry) => entry.stepId, context, ["authored", "lesson", "stepsChanged"], "changed lesson step");
    const addedStepIds = new Set(lesson.stepsAdded.map((entry) => entry.step.id));
    const removedStepIds = new Set(lesson.stepsRemoved.map((entry) => entry.step.id));
    const addedStepIndexes = new Set<number>();
    lesson.stepsAdded.forEach((entry, index) => {
      if (addedStepIndexes.has(entry.index)) {
        context.addIssue({ code: "custom", message: `duplicate added lesson step index: ${entry.index}`, path: ["authored", "lesson", "stepsAdded", index, "index"] });
      }
      if (removedStepIds.has(entry.step.id)) {
        context.addIssue({ code: "custom", message: "a lesson step cannot be both added and removed", path: ["authored", "lesson", "stepsAdded", index] });
      }
      addedStepIndexes.add(entry.index);
    });
    const removedStepIndexes = new Set<number>();
    lesson.stepsRemoved.forEach((entry, index) => {
      if (removedStepIndexes.has(entry.index)) {
        context.addIssue({ code: "custom", message: `duplicate removed lesson step index: ${entry.index}`, path: ["authored", "lesson", "stepsRemoved", index, "index"] });
      }
      removedStepIndexes.add(entry.index);
    });
    const movedBeforeIndexes = new Set<number>();
    const movedAfterIndexes = new Set<number>();
    const movedBeforeCommonIndexes = new Set<number>();
    const movedAfterCommonIndexes = new Set<number>();
    lesson.stepsMoved.forEach((entry, index) => {
      if (addedStepIds.has(entry.stepId) || removedStepIds.has(entry.stepId)) {
        context.addIssue({ code: "custom", message: "added or removed steps cannot also move", path: ["authored", "lesson", "stepsMoved", index] });
      }
      for (const [value, seen, field] of [
        [entry.beforeIndex, movedBeforeIndexes, "beforeIndex"],
        [entry.afterIndex, movedAfterIndexes, "afterIndex"],
        [entry.beforeCommonIndex, movedBeforeCommonIndexes, "beforeCommonIndex"],
        [entry.afterCommonIndex, movedAfterCommonIndexes, "afterCommonIndex"],
      ] as const) {
        if (seen.has(value)) {
          context.addIssue({ code: "custom", message: `duplicate moved-step ${field}: ${value}`, path: ["authored", "lesson", "stepsMoved", index, field] });
        }
        seen.add(value);
      }
    });
    lesson.stepsChanged.forEach((entry, index) => {
      if (addedStepIds.has(entry.stepId) || removedStepIds.has(entry.stepId)) {
        context.addIssue({ code: "custom", message: "added or removed steps cannot also be changed", path: ["authored", "lesson", "stepsChanged", index] });
      }
    });

    const modelAuthoredChanged =
      model.cellsAdded.length > 0 ||
      model.cellsRemoved.length > 0 ||
      model.scalarChanges.length > 0 ||
      model.localizedChanges.length > 0 ||
      model.termIds.added.length > 0 ||
      model.termIds.removed.length > 0 ||
      model.prerequisiteTermIds.added.length > 0 ||
      model.prerequisiteTermIds.removed.length > 0;
    const authoredChanged =
      modelAuthoredChanged ||
      lesson.stepsAdded.length > 0 ||
      lesson.stepsRemoved.length > 0 ||
      lesson.stepsMoved.length > 0 ||
      lesson.stepsChanged.length > 0 ||
      Object.keys(lesson.checkpoint).length > 0;
    const sourceChanged = diff.before.draftHash !== diff.after.draftHash;
    if (sourceChanged !== authoredChanged) {
      context.addIssue({ code: "custom", message: "draft hash change must match authored semantic changes", path: ["authored"] });
    }
    if (!sourceChanged) {
      if (diff.before.sceneHash !== diff.after.sceneHash || diff.before.pageHash !== diff.after.pageHash) {
        context.addIssue({ code: "custom", message: "an unchanged draft must keep compiled hashes", path: ["after"] });
      }
      if (diff.derived.layerSteps) {
        context.addIssue({ code: "custom", message: "an unchanged draft cannot have derived layer changes", path: ["derived", "layerSteps"] });
      }
      if (diff.derived.voxelMath) {
        context.addIssue({ code: "custom", message: "an unchanged draft cannot have derived voxel math changes", path: ["derived", "voxelMath"] });
      }
    }
    const layerAxisChange = model.scalarChanges.find((change) => change.field === "layerAxis");
    const layerScanChanges = lesson.stepsChanged.filter(
      (change) => change.kind === "layer-scan",
    );
    const voxelMathRequired =
      model.cellsAdded.length > 0 || model.cellsRemoved.length > 0 || Boolean(layerAxisChange);
    const layerStepsRequired =
      voxelMathRequired || layerScanChanges.length > 0;
    if (diff.derived.layerSteps) {
      const layerStepsChanged =
        canonicalJsonStringify(diff.derived.layerSteps.before) !==
        canonicalJsonStringify(diff.derived.layerSteps.after);
      if (diff.derived.layerSteps.changed !== layerStepsChanged) {
        context.addIssue({ code: "custom", message: "derived layer-step changed flag is incoherent", path: ["derived", "layerSteps", "changed"] });
      }
      if (diff.derived.layerSteps.changed && diff.before.sceneHash === diff.after.sceneHash) {
        context.addIssue({ code: "custom", message: "derived layer changes require a scene hash change", path: ["derived", "layerSteps"] });
      }
      if (!layerStepsRequired) {
        context.addIssue({ code: "custom", message: "derived layer steps require model or layer-scan changes", path: ["derived", "layerSteps"] });
      }
      const authoredLayerChangeMustCompile = layerScanChanges.some(
        (change) =>
          Boolean(change.title || change.teacherPrompt) ||
          Boolean(
            change.order &&
              Math.max(
                diff.derived.layerSteps?.before.length ?? 0,
                diff.derived.layerSteps?.after.length ?? 0,
              ) > 1,
          ),
      );
      if (authoredLayerChangeMustCompile && !diff.derived.layerSteps.changed) {
        context.addIssue({
          code: "custom",
          message: "authored layer-scan content must change compiled layer steps",
          path: ["derived", "layerSteps", "changed"],
        });
      }
    } else if (layerStepsRequired) {
      context.addIssue({ code: "custom", message: "model or layer-scan changes require derived layer-step snapshots", path: ["derived", "layerSteps"] });
    }
    const countDelta = model.cellsAdded.length - model.cellsRemoved.length;
    if (diff.derived.voxelMath) {
      const voxelMath = diff.derived.voxelMath;
      const voxelMathChanged =
        canonicalJsonStringify(voxelMath.before) !== canonicalJsonStringify(voxelMath.after);
      if (voxelMath.changed !== voxelMathChanged) {
        context.addIssue({ code: "custom", message: "derived voxel-math changed flag is incoherent", path: ["derived", "voxelMath", "changed"] });
      }
      if (diff.before.sceneHash === diff.after.sceneHash) {
        context.addIssue({ code: "custom", message: "derived voxel math changes require a scene hash change", path: ["derived", "voxelMath"] });
      }
      if (!voxelMathRequired) {
        context.addIssue({ code: "custom", message: "derived voxel math requires authored cells or layerAxis changes", path: ["derived", "voxelMath"] });
      }
      if (voxelMath.after.totalCount - voxelMath.before.totalCount !== countDelta) {
        context.addIssue({ code: "custom", message: "derived totalCount must match the authored cell delta", path: ["derived", "voxelMath", "after", "totalCount"] });
      }
      if (layerAxisChange) {
        if (
          voxelMath.before.layerAxis !== layerAxisChange.before ||
          voxelMath.after.layerAxis !== layerAxisChange.after
        ) {
          context.addIssue({ code: "custom", message: "derived layer axes must match the authored layerAxis change", path: ["derived", "voxelMath"] });
        }
      } else if (voxelMath.before.layerAxis !== voxelMath.after.layerAxis) {
        context.addIssue({ code: "custom", message: "derived layerAxis cannot change without an authored change", path: ["derived", "voxelMath", "after", "layerAxis"] });
      }
    } else if (voxelMathRequired) {
      context.addIssue({ code: "custom", message: "cell or layerAxis changes require derived voxel-math snapshots", path: ["derived", "voxelMath"] });
    }
    if (diff.derived.voxelMath && diff.derived.layerSteps) {
      for (const side of ["before", "after"] as const) {
        const math = diff.derived.voxelMath[side];
        const steps = [...diff.derived.layerSteps[side]].sort(
          (left, right) => left.canonicalOrdinal - right.canonicalOrdinal,
        );
        if (
          steps.length !== math.layerCounts.length ||
          steps.some(
            (step, index) =>
              step.axis !== math.layerAxis ||
              step.coordinate !== math.layerCounts[index]?.coordinate,
          )
        ) {
          context.addIssue({ code: "custom", message: `derived ${side} layer steps must match the voxel-math layers`, path: ["derived", "layerSteps", side] });
        }
      }
    }
    if (diff.derived.layerSteps && !diff.derived.voxelMath) {
      const layerIdentity = (side: "before" | "after") =>
        [...diff.derived.layerSteps![side]]
          .sort((left, right) => left.canonicalOrdinal - right.canonicalOrdinal)
          .map((step) => ({
            layerId: step.layerId,
            axis: step.axis,
            coordinate: step.coordinate,
            canonicalOrdinal: step.canonicalOrdinal,
          }));
      if (
        canonicalJsonStringify(layerIdentity("before")) !==
        canonicalJsonStringify(layerIdentity("after"))
      ) {
        context.addIssue({
          code: "custom",
          message: "lesson-only layer changes must preserve compiled layer identity",
          path: ["derived", "layerSteps"],
        });
      }
    }

    const nonLayerLessonSceneChange =
      lesson.stepsAdded.length > 0 ||
      lesson.stepsRemoved.length > 0 ||
      lesson.stepsMoved.length > 0 ||
      lesson.stepsChanged.some((change) => change.kind !== "layer-scan");
    const sceneMustChange =
      modelAuthoredChanged ||
      nonLayerLessonSceneChange ||
      Boolean(diff.derived.layerSteps?.changed) ||
      Boolean(lesson.checkpoint.prompt);
    const sceneChanged = diff.before.sceneHash !== diff.after.sceneHash;
    if (sceneChanged !== sceneMustChange) {
      context.addIssue({
        code: "custom",
        message: sceneMustChange
          ? "compiled scene hash must change for authored scene content"
          : "compiled scene hash must stay unchanged without authored scene content",
        path: ["after", "sceneHash"],
      });
    }
    const pageMustChange =
      sceneMustChange ||
      Boolean(lesson.checkpoint.required) ||
      Boolean(lesson.checkpoint.maxSubmissions);
    const pageChanged = diff.before.pageHash !== diff.after.pageHash;
    if (pageChanged !== pageMustChange) {
      context.addIssue({
        code: "custom",
        message: pageMustChange
          ? "compiled page hash must change for authored page content"
          : "compiled page hash must stay unchanged without authored page content",
        path: ["after", "pageHash"],
      });
    }

    try {
      const bytes = new TextEncoder().encode(canonicalJsonStringify(diff)).byteLength;
      if (bytes > VOXEL_AUTHORING_DIFF_LIMITS.maxBytes) {
        context.addIssue({ code: "custom", message: `authoring diff size ${bytes} exceeds ${VOXEL_AUTHORING_DIFF_LIMITS.maxBytes} bytes`, path: [] });
      }
    } catch {
      context.addIssue({ code: "custom", message: "authoring diff must contain only canonical JSON values", path: [] });
    }
  });

export type VoxelAuthoringDiff = z.infer<typeof voxelAuthoringDiffSchema>;

export function parseVoxelAuthoringDiff(input: unknown): VoxelAuthoringDiff {
  return voxelAuthoringDiffSchema.parse(input);
}

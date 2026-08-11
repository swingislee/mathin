import { z } from "zod";
import { canonicalJsonStringify } from "./canonical-json";
import { exactVector3Schema, rationalSchema } from "./exact";
import { SPATIAL_OWNERSHIP_MODES } from "./page-schema";
import { voxelCoordinateSchema } from "./voxel-schema";
import { FACE_DIRECTIONS, SPATIAL_VOXEL_LIMITS } from "./voxel-types";

export const SPATIAL_RUNTIME_STATE_VERSION = "spatial-runtime-state-v1" as const;
export const SPATIAL_COMMAND_VERSION = "spatial-command-v1" as const;

export const SPATIAL_RUNTIME_LIMITS = {
  maxStateBytes: 256 * 1_024,
  maxCommandBytes: 32 * 1_024,
  maxCommandVoxels: 512,
  maxEntitySelections: 256,
  maxEpoch: 1_000_000_000,
  maxSequence: Number.MAX_SAFE_INTEGER,
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
const commandFingerprintSchema = z.string().regex(/^[0-9a-f]{16}$/, "invalid command fingerprint");

export const spatialRuntimeBranchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("teacher-authority") }).strict(),
  z.object({ kind: z.literal("student-local"), studentActorId: stableIdSchema }).strict(),
]);

const spatialCommandActorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("teacher-controller"), actorId: stableIdSchema }).strict(),
  z.object({ kind: z.literal("student"), actorId: stableIdSchema }).strict(),
]);

const commandVoxelListSchema = z.array(voxelCoordinateSchema).min(1).max(SPATIAL_RUNTIME_LIMITS.maxCommandVoxels);

export const spatialCommandPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("view.set"), view: z.enum(["front", "right", "top", "perspective"]) }).strict(),
  z.object({ kind: z.literal("camera.bookmark.apply"), cameraId: stableIdSchema }).strict(),
  z.object({ kind: z.literal("layer.set"), layerId: stableIdSchema, visible: z.boolean() }).strict(),
  z
    .object({
      kind: z.literal("visibility.set"),
      entityIds: z.array(stableIdSchema).min(1).max(SPATIAL_RUNTIME_LIMITS.maxEntitySelections),
      visible: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal("voxel.add"), entityId: stableIdSchema, cells: commandVoxelListSchema }).strict(),
  z.object({ kind: z.literal("voxel.remove"), entityId: stableIdSchema, cells: commandVoxelListSchema }).strict(),
  z
    .object({
      kind: z.literal("voxel.paint"),
      entityId: stableIdSchema,
      cells: commandVoxelListSchema,
      directions: z.array(z.enum(FACE_DIRECTIONS)).min(1).max(FACE_DIRECTIONS.length),
      materialToken: semanticTokenSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("entity.select"),
      entityIds: z.array(stableIdSchema).max(SPATIAL_RUNTIME_LIMITS.maxEntitySelections),
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
  z.object({ kind: z.literal("step.go"), stepId: stableIdSchema }).strict(),
  z.object({ kind: z.literal("ownership.set"), mode: z.enum(SPATIAL_OWNERSHIP_MODES) }).strict(),
  z.object({ kind: z.literal("scene.reset") }).strict(),
]);

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function coordinateKey(cell: { readonly x: number; readonly y: number; readonly z: number }): string {
  return `${cell.x},${cell.y},${cell.z}`;
}

function compareCoordinates(
  left: { readonly x: number; readonly y: number; readonly z: number },
  right: { readonly x: number; readonly y: number; readonly z: number },
): number {
  return left.x - right.x || left.y - right.y || left.z - right.z;
}

function addStableOrderIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  path: (string | number)[],
  label: string,
  order?: readonly string[],
): void {
  const seen = new Set<string>();
  const indices = order ? new Map(order.map((value, index) => [value, index])) : undefined;
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({ code: "custom", message: `duplicate ${label}: ${value}`, path: [...path, index] });
    }
    seen.add(value);
    if (index === 0) return;
    const previous = values[index - 1];
    const unordered = indices
      ? (indices.get(previous) ?? -1) > (indices.get(value) ?? -1)
      : compareStableStrings(previous, value) > 0;
    if (unordered) context.addIssue({ code: "custom", message: `${label} must use stable order`, path });
  });
}

function addCoordinateIssues(
  cells: readonly { readonly x: number; readonly y: number; readonly z: number }[],
  context: z.RefinementCtx,
  path: (string | number)[],
  label: string,
): void {
  const seen = new Set<string>();
  cells.forEach((cell, index) => {
    const key = coordinateKey(cell);
    if (seen.has(key)) context.addIssue({ code: "custom", message: `duplicate ${label}: ${key}`, path: [...path, index] });
    seen.add(key);
    if (index > 0 && compareCoordinates(cells[index - 1], cell) > 0) {
      context.addIssue({ code: "custom", message: `${label} must use stable coordinate order`, path });
    }
  });
}

export const spatialCommandSchema = z
  .object({
    commandVersion: z.literal(SPATIAL_COMMAND_VERSION),
    commandId: stableIdSchema,
    sceneRevisionHash: sha256Schema,
    resetEpoch: z.number().int().min(0).max(SPATIAL_RUNTIME_LIMITS.maxEpoch),
    sequence: z.number().int().min(1).max(SPATIAL_RUNTIME_LIMITS.maxSequence),
    delivery: z.literal("durable-semantic"),
    branch: spatialRuntimeBranchSchema,
    actor: spatialCommandActorSchema,
    payload: spatialCommandPayloadSchema,
  })
  .strict()
  .superRefine((command, context) => {
    const payload = command.payload;
    if (payload.kind === "visibility.set" || payload.kind === "entity.select") {
      addStableOrderIssues(payload.entityIds, context, ["payload", "entityIds"], "entity id");
    }
    if (payload.kind === "voxel.add" || payload.kind === "voxel.remove" || payload.kind === "voxel.paint") {
      addCoordinateIssues(payload.cells, context, ["payload", "cells"], "voxel coordinate");
    }
    if (payload.kind === "voxel.paint") {
      addStableOrderIssues(payload.directions, context, ["payload", "directions"], "face direction", FACE_DIRECTIONS);
    }
    if (
      payload.kind === "section.plane.set" &&
      payload.normal.x.numerator === 0 &&
      payload.normal.y.numerator === 0 &&
      payload.normal.z.numerator === 0
    ) {
      context.addIssue({ code: "custom", message: "section plane normal must be non-zero", path: ["payload", "normal"] });
    }
    const bytes = new TextEncoder().encode(canonicalJsonStringify(command)).byteLength;
    if (bytes > SPATIAL_RUNTIME_LIMITS.maxCommandBytes) {
      context.addIssue({ code: "custom", message: `command size ${bytes} exceeds limit`, path: [] });
    }
  });

const entityVisibilitySchema = z.object({ entityId: stableIdSchema, visible: z.boolean() }).strict();
const layerVisibilitySchema = z.object({ layerId: stableIdSchema, visible: z.boolean() }).strict();
const parameterValueSchema = z.object({ parameterId: stableIdSchema, value: rationalSchema }).strict();
const netFoldSchema = z.object({ entityId: stableIdSchema, progress: z.number().finite().min(0).max(1) }).strict();
const sectionPlaneSchema = z
  .object({
    targetEntityId: stableIdSchema,
    planeGuideId: stableIdSchema,
    normal: exactVector3Schema,
    constant: rationalSchema,
  })
  .strict();
const facePaintSchema = z.object({ direction: z.enum(FACE_DIRECTIONS), materialToken: semanticTokenSchema }).strict();
const voxelPaintSchema = z
  .object({ cell: voxelCoordinateSchema, faces: z.array(facePaintSchema).min(1).max(FACE_DIRECTIONS.length) })
  .strict();
const voxelEditSchema = z
  .object({
    entityId: stableIdSchema,
    addedCells: z.array(voxelCoordinateSchema).max(SPATIAL_VOXEL_LIMITS.maxCells),
    removedCells: z.array(voxelCoordinateSchema).max(SPATIAL_VOXEL_LIMITS.maxCells),
    paints: z.array(voxelPaintSchema).max(SPATIAL_VOXEL_LIMITS.maxCells),
  })
  .strict();

export const spatialRuntimeStateSchema = z
  .object({
    stateVersion: z.literal(SPATIAL_RUNTIME_STATE_VERSION),
    sceneRevisionHash: sha256Schema,
    resetEpoch: z.number().int().min(0).max(SPATIAL_RUNTIME_LIMITS.maxEpoch),
    branch: spatialRuntimeBranchSchema,
    ownershipMode: z.enum(SPATIAL_OWNERSHIP_MODES),
    activeView: z.enum(["front", "right", "top", "perspective"]).nullable(),
    cameraBookmarkId: stableIdSchema,
    activeStepId: stableIdSchema.nullable(),
    entityVisibility: z.array(entityVisibilitySchema).max(256),
    layerVisibility: z.array(layerVisibilitySchema).max(100),
    selectedEntityIds: z.array(stableIdSchema).max(SPATIAL_RUNTIME_LIMITS.maxEntitySelections),
    voxelEdits: z.array(voxelEditSchema).max(256),
    netFoldProgress: z.array(netFoldSchema).max(256),
    sectionPlanes: z.array(sectionPlaneSchema).max(256),
    parameterValues: z.array(parameterValueSchema).max(64),
    lastAppliedSequence: z.number().int().min(0).max(SPATIAL_RUNTIME_LIMITS.maxSequence),
    lastCommandId: stableIdSchema.nullable(),
    lastCommandFingerprint: commandFingerprintSchema.nullable(),
  })
  .strict()
  .superRefine((state, context) => {
    if (
      (state.lastAppliedSequence === 0) !==
      (state.lastCommandId === null && state.lastCommandFingerprint === null)
    ) {
      context.addIssue({ code: "custom", message: "initial sequence, command id and fingerprint must be empty together", path: ["lastCommandId"] });
    }
    if ((state.lastCommandId === null) !== (state.lastCommandFingerprint === null)) {
      context.addIssue({ code: "custom", message: "command id and fingerprint must be present together", path: ["lastCommandFingerprint"] });
    }
    addStableOrderIssues(state.entityVisibility.map((entry) => entry.entityId), context, ["entityVisibility"], "entity visibility id");
    addStableOrderIssues(state.layerVisibility.map((entry) => entry.layerId), context, ["layerVisibility"], "layer visibility id");
    addStableOrderIssues(state.selectedEntityIds, context, ["selectedEntityIds"], "selected entity id");
    addStableOrderIssues(state.voxelEdits.map((entry) => entry.entityId), context, ["voxelEdits"], "voxel edit entity id");
    addStableOrderIssues(state.netFoldProgress.map((entry) => entry.entityId), context, ["netFoldProgress"], "net fold entity id");
    addStableOrderIssues(state.sectionPlanes.map((entry) => `${entry.targetEntityId}:${entry.planeGuideId}`), context, ["sectionPlanes"], "section plane key");
    addStableOrderIssues(state.parameterValues.map((entry) => entry.parameterId), context, ["parameterValues"], "parameter id");
    state.voxelEdits.forEach((edit, editIndex) => {
      addCoordinateIssues(edit.addedCells, context, ["voxelEdits", editIndex, "addedCells"], "added voxel");
      addCoordinateIssues(edit.removedCells, context, ["voxelEdits", editIndex, "removedCells"], "removed voxel");
      addCoordinateIssues(edit.paints.map((paint) => paint.cell), context, ["voxelEdits", editIndex, "paints"], "painted voxel");
      edit.paints.forEach((paint, paintIndex) =>
        addStableOrderIssues(
          paint.faces.map((face) => face.direction),
          context,
          ["voxelEdits", editIndex, "paints", paintIndex, "faces"],
          "painted face direction",
          FACE_DIRECTIONS,
        ),
      );
    });
    state.sectionPlanes.forEach((plane, index) => {
      if (plane.normal.x.numerator === 0 && plane.normal.y.numerator === 0 && plane.normal.z.numerator === 0) {
        context.addIssue({ code: "custom", message: "section plane normal must be non-zero", path: ["sectionPlanes", index, "normal"] });
      }
    });
    const bytes = new TextEncoder().encode(canonicalJsonStringify(state)).byteLength;
    if (bytes > SPATIAL_RUNTIME_LIMITS.maxStateBytes) {
      context.addIssue({ code: "custom", message: `runtime state size ${bytes} exceeds limit`, path: [] });
    }
  });

export type SpatialRuntimeBranch = z.infer<typeof spatialRuntimeBranchSchema>;
export type SpatialCommandActor = z.infer<typeof spatialCommandActorSchema>;
export type SpatialCommandPayload = z.infer<typeof spatialCommandPayloadSchema>;
export type SpatialCommand = z.infer<typeof spatialCommandSchema>;
export type SpatialRuntimeState = z.infer<typeof spatialRuntimeStateSchema>;

export function parseSpatialCommand(input: unknown): SpatialCommand {
  return spatialCommandSchema.parse(input);
}

export function parseSpatialRuntimeState(input: unknown): SpatialRuntimeState {
  return spatialRuntimeStateSchema.parse(input);
}

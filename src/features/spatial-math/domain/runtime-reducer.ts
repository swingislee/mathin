import { canonicalJsonStringify } from "./canonical-json";
import { compareRationals, type Rational } from "./exact";
import { parseSpatialPageDoc, type SpatialPageDoc } from "./page-schema";
import {
  SPATIAL_COMMAND_VERSION,
  SPATIAL_RUNTIME_STATE_VERSION,
  parseSpatialCommand,
  parseSpatialRuntimeState,
  spatialRuntimeStateSchema,
  type SpatialCommand,
  type SpatialCommandPayload,
  type SpatialRuntimeBranch,
  type SpatialRuntimeState,
} from "./runtime-schema";
import type { SpatialSceneAction } from "./scene-schema";
import { compareVoxelCoordinates, voxelKey } from "./voxel-schema";
import { FACE_DIRECTIONS, type VoxelCoordinate } from "./voxel-types";

export const SPATIAL_RUNTIME_ERROR_CODES = {
  stateSceneMismatch: "SPATIAL_RUNTIME_STATE_SCENE_MISMATCH",
  commandSceneMismatch: "SPATIAL_RUNTIME_COMMAND_SCENE_MISMATCH",
  branchMismatch: "SPATIAL_RUNTIME_BRANCH_MISMATCH",
  epochMismatch: "SPATIAL_RUNTIME_EPOCH_MISMATCH",
  staleSequence: "SPATIAL_RUNTIME_STALE_SEQUENCE",
  sequenceGap: "SPATIAL_RUNTIME_SEQUENCE_GAP",
  actorNotAllowed: "SPATIAL_RUNTIME_ACTOR_NOT_ALLOWED",
  ownershipNotAllowed: "SPATIAL_RUNTIME_OWNERSHIP_NOT_ALLOWED",
  referenceInvalid: "SPATIAL_RUNTIME_REFERENCE_INVALID",
  operationInvalid: "SPATIAL_RUNTIME_OPERATION_INVALID",
  stateInvalid: "SPATIAL_RUNTIME_STATE_INVALID",
} as const;

export type SpatialRuntimeErrorCode =
  (typeof SPATIAL_RUNTIME_ERROR_CODES)[keyof typeof SPATIAL_RUNTIME_ERROR_CODES];

export class SpatialRuntimeContractError extends Error {
  constructor(public readonly code: SpatialRuntimeErrorCode, message: string) {
    super(message);
    this.name = "SpatialRuntimeContractError";
  }
}

function fail(code: SpatialRuntimeErrorCode, message: string): never {
  throw new SpatialRuntimeContractError(code, message);
}

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function branchEquals(left: SpatialRuntimeBranch, right: SpatialRuntimeBranch): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

function initialStateBody(
  page: SpatialPageDoc,
  branch: SpatialRuntimeBranch,
  ownershipMode = page.classroom.ownership.defaultMode,
  resetEpoch = 0,
  lastAppliedSequence = 0,
  lastCommandId: string | null = null,
  lastCommandFingerprint: string | null = null,
): SpatialRuntimeState {
  return {
    stateVersion: SPATIAL_RUNTIME_STATE_VERSION,
    sceneRevisionHash: page.sceneHash,
    resetEpoch,
    branch,
    ownershipMode,
    activeView: null,
    cameraBookmarkId: page.presentation.camera.defaultCameraId,
    activeStepId: page.scene.sequence.initialStepId ?? null,
    entityVisibility: page.scene.model.entities
      .map((entity) => ({ entityId: entity.id, visible: entity.visible }))
      .sort((left, right) => compareStableStrings(left.entityId, right.entityId)),
    layerVisibility: page.scene.presentation.layers
      .map((layer) => ({ layerId: layer.id, visible: layer.initiallyVisible }))
      .sort((left, right) => compareStableStrings(left.layerId, right.layerId)),
    selectedEntityIds: [],
    voxelEdits: [],
    netFoldProgress: [],
    sectionPlanes: [],
    parameterValues: page.scene.model.parameters
      .map((parameter) => ({ parameterId: parameter.id, value: parameter.initial }))
      .sort((left, right) => compareStableStrings(left.parameterId, right.parameterId)),
    lastAppliedSequence,
    lastCommandId,
    lastCommandFingerprint,
  };
}

function validStateOrFail(state: SpatialRuntimeState): SpatialRuntimeState {
  const result = spatialRuntimeStateSchema.safeParse(state);
  if (!result.success) {
    fail(
      SPATIAL_RUNTIME_ERROR_CODES.stateInvalid,
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }
  return result.data;
}

function entity(page: SpatialPageDoc, entityId: string) {
  const found = page.scene.model.entities.find((candidate) => candidate.id === entityId);
  if (!found) fail(SPATIAL_RUNTIME_ERROR_CODES.referenceInvalid, `unknown entity: ${entityId}`);
  return found;
}

function voxelEntity(page: SpatialPageDoc, entityId: string) {
  const found = entity(page, entityId);
  if (found.type !== "voxel-set") {
    fail(SPATIAL_RUNTIME_ERROR_CODES.referenceInvalid, `entity must be voxel-set: ${entityId}`);
  }
  return found;
}

function validateStateReferences(page: SpatialPageDoc, state: SpatialRuntimeState): void {
  if (!page.classroom.ownership.allowedModes.includes(state.ownershipMode)) {
    fail(SPATIAL_RUNTIME_ERROR_CODES.ownershipNotAllowed, `ownership mode is not allowed: ${state.ownershipMode}`);
  }
  if (!page.scene.presentation.cameraBookmarks.some((camera) => camera.id === state.cameraBookmarkId)) {
    fail(SPATIAL_RUNTIME_ERROR_CODES.referenceInvalid, `unknown state camera: ${state.cameraBookmarkId}`);
  }
  if (state.activeStepId && !page.scene.sequence.steps.some((step) => step.id === state.activeStepId)) {
    fail(SPATIAL_RUNTIME_ERROR_CODES.referenceInvalid, `unknown active step: ${state.activeStepId}`);
  }

  const expectedEntities = page.scene.model.entities.map((item) => item.id).sort(compareStableStrings);
  const stateEntities = state.entityVisibility.map((item) => item.entityId);
  if (canonicalJsonStringify(expectedEntities) !== canonicalJsonStringify(stateEntities)) {
    fail(SPATIAL_RUNTIME_ERROR_CODES.referenceInvalid, "state entity visibility does not match scene entities");
  }
  const expectedLayers = page.scene.presentation.layers.map((item) => item.id).sort(compareStableStrings);
  const stateLayers = state.layerVisibility.map((item) => item.layerId);
  if (canonicalJsonStringify(expectedLayers) !== canonicalJsonStringify(stateLayers)) {
    fail(SPATIAL_RUNTIME_ERROR_CODES.referenceInvalid, "state layer visibility does not match scene layers");
  }
  const expectedParameters = page.scene.model.parameters.map((item) => item.id).sort(compareStableStrings);
  const stateParameters = state.parameterValues.map((item) => item.parameterId);
  if (canonicalJsonStringify(expectedParameters) !== canonicalJsonStringify(stateParameters)) {
    fail(SPATIAL_RUNTIME_ERROR_CODES.referenceInvalid, "state parameters do not match scene parameters");
  }

  state.selectedEntityIds.forEach((entityId) => entity(page, entityId));
  state.voxelEdits.forEach((edit) => voxelEntity(page, edit.entityId));
  state.netFoldProgress.forEach((fold) => {
    if (entity(page, fold.entityId).type !== "polyhedron") {
      fail(SPATIAL_RUNTIME_ERROR_CODES.referenceInvalid, `net fold entity must be polyhedron: ${fold.entityId}`);
    }
  });
  state.sectionPlanes.forEach((plane) => {
    entity(page, plane.targetEntityId);
    const guide = entity(page, plane.planeGuideId);
    if (guide.type !== "guide" || guide.definition.kind !== "plane") {
      fail(SPATIAL_RUNTIME_ERROR_CODES.referenceInvalid, `section guide must define a plane: ${plane.planeGuideId}`);
    }
  });
}

function voxelEdit(state: SpatialRuntimeState, entityId: string) {
  let edit = state.voxelEdits.find((candidate) => candidate.entityId === entityId);
  if (!edit) {
    edit = { entityId, addedCells: [], removedCells: [], paints: [] };
    state.voxelEdits.push(edit);
    state.voxelEdits.sort((left, right) => compareStableStrings(left.entityId, right.entityId));
  }
  return edit;
}

function cellExists(page: SpatialPageDoc, state: SpatialRuntimeState, entityId: string, cell: VoxelCoordinate): boolean {
  const base = voxelEntity(page, entityId).cells.some((candidate) => voxelKey(candidate) === voxelKey(cell));
  const edit = state.voxelEdits.find((candidate) => candidate.entityId === entityId);
  if (!edit) return base;
  if (edit.removedCells.some((candidate) => voxelKey(candidate) === voxelKey(cell))) return false;
  return base || edit.addedCells.some((candidate) => voxelKey(candidate) === voxelKey(cell));
}

function removeCell(cells: VoxelCoordinate[], target: VoxelCoordinate): void {
  const index = cells.findIndex((cell) => voxelKey(cell) === voxelKey(target));
  if (index >= 0) cells.splice(index, 1);
}

function cleanupVoxelEdit(state: SpatialRuntimeState, entityId: string): void {
  const index = state.voxelEdits.findIndex((edit) => edit.entityId === entityId);
  if (index < 0) return;
  const edit = state.voxelEdits[index];
  if (edit.addedCells.length === 0 && edit.removedCells.length === 0 && edit.paints.length === 0) {
    state.voxelEdits.splice(index, 1);
  }
}

function addVoxels(page: SpatialPageDoc, state: SpatialRuntimeState, entityId: string, cells: VoxelCoordinate[]): void {
  const baseKeys = new Set(voxelEntity(page, entityId).cells.map(voxelKey));
  const edit = voxelEdit(state, entityId);
  cells.forEach((cell) => {
    if (cellExists(page, state, entityId, cell)) {
      fail(SPATIAL_RUNTIME_ERROR_CODES.operationInvalid, `cannot add occupied voxel: ${voxelKey(cell)}`);
    }
    if (baseKeys.has(voxelKey(cell))) removeCell(edit.removedCells, cell);
    else edit.addedCells.push(cell);
  });
  edit.addedCells.sort(compareVoxelCoordinates);
  cleanupVoxelEdit(state, entityId);
}

function removeVoxels(page: SpatialPageDoc, state: SpatialRuntimeState, entityId: string, cells: VoxelCoordinate[]): void {
  const baseKeys = new Set(voxelEntity(page, entityId).cells.map(voxelKey));
  const edit = voxelEdit(state, entityId);
  cells.forEach((cell) => {
    if (!cellExists(page, state, entityId, cell)) {
      fail(SPATIAL_RUNTIME_ERROR_CODES.operationInvalid, `cannot remove empty voxel: ${voxelKey(cell)}`);
    }
    if (baseKeys.has(voxelKey(cell))) edit.removedCells.push(cell);
    else removeCell(edit.addedCells, cell);
    const paintIndex = edit.paints.findIndex((paint) => voxelKey(paint.cell) === voxelKey(cell));
    if (paintIndex >= 0) edit.paints.splice(paintIndex, 1);
  });
  edit.removedCells.sort(compareVoxelCoordinates);
  cleanupVoxelEdit(state, entityId);
}

function paintVoxels(
  page: SpatialPageDoc,
  state: SpatialRuntimeState,
  entityId: string,
  cells: VoxelCoordinate[],
  directions: (typeof FACE_DIRECTIONS)[number][],
  materialToken: string,
): void {
  const edit = voxelEdit(state, entityId);
  cells.forEach((cell) => {
    if (!cellExists(page, state, entityId, cell)) {
      fail(SPATIAL_RUNTIME_ERROR_CODES.operationInvalid, `cannot paint empty voxel: ${voxelKey(cell)}`);
    }
    let paint = edit.paints.find((candidate) => voxelKey(candidate.cell) === voxelKey(cell));
    if (!paint) {
      paint = { cell, faces: [] };
      edit.paints.push(paint);
    }
    directions.forEach((direction) => {
      const face = paint?.faces.find((candidate) => candidate.direction === direction);
      if (face) face.materialToken = materialToken;
      else paint?.faces.push({ direction, materialToken });
    });
    paint.faces.sort((left, right) => FACE_DIRECTIONS.indexOf(left.direction) - FACE_DIRECTIONS.indexOf(right.direction));
  });
  edit.paints.sort((left, right) => compareVoxelCoordinates(left.cell, right.cell));
}

function rationalOnStep(value: Rational, min: Rational, step: Rational): boolean {
  const differenceNumerator =
    BigInt(value.numerator) * BigInt(min.denominator) - BigInt(min.numerator) * BigInt(value.denominator);
  const differenceDenominator = BigInt(value.denominator) * BigInt(min.denominator);
  const ratioNumerator = differenceNumerator * BigInt(step.denominator);
  const ratioDenominator = differenceDenominator * BigInt(step.numerator);
  return ratioDenominator !== BigInt(0) && ratioNumerator % ratioDenominator === BigInt(0);
}

function resetMutableState(page: SpatialPageDoc, state: SpatialRuntimeState, activeStepId: string | null): void {
  const reset = initialStateBody(
    page,
    state.branch,
    state.ownershipMode,
    state.resetEpoch,
    state.lastAppliedSequence,
    state.lastCommandId,
    state.lastCommandFingerprint,
  );
  state.activeView = reset.activeView;
  state.cameraBookmarkId = reset.cameraBookmarkId;
  state.activeStepId = activeStepId;
  state.entityVisibility = reset.entityVisibility;
  state.layerVisibility = reset.layerVisibility;
  state.selectedEntityIds = reset.selectedEntityIds;
  state.voxelEdits = reset.voxelEdits;
  state.netFoldProgress = reset.netFoldProgress;
  state.sectionPlanes = reset.sectionPlanes;
  state.parameterValues = reset.parameterValues;
}

function applyPayload(page: SpatialPageDoc, state: SpatialRuntimeState, payload: SpatialCommandPayload): void {
  if (payload.kind === "view.set") {
    state.activeView = payload.view;
    return;
  }
  if (payload.kind === "camera.bookmark.apply") {
    if (!page.scene.presentation.cameraBookmarks.some((camera) => camera.id === payload.cameraId)) {
      fail(SPATIAL_RUNTIME_ERROR_CODES.referenceInvalid, `unknown camera: ${payload.cameraId}`);
    }
    state.cameraBookmarkId = payload.cameraId;
    return;
  }
  if (payload.kind === "layer.set") {
    const layer = state.layerVisibility.find((candidate) => candidate.layerId === payload.layerId);
    if (!layer) fail(SPATIAL_RUNTIME_ERROR_CODES.referenceInvalid, `unknown layer: ${payload.layerId}`);
    layer.visible = payload.visible;
    return;
  }
  if (payload.kind === "visibility.set") {
    payload.entityIds.forEach((entityId) => {
      const entry = state.entityVisibility.find((candidate) => candidate.entityId === entityId);
      if (!entry) fail(SPATIAL_RUNTIME_ERROR_CODES.referenceInvalid, `unknown entity: ${entityId}`);
      entry.visible = payload.visible;
    });
    return;
  }
  if (payload.kind === "entity.select") {
    payload.entityIds.forEach((entityId) => entity(page, entityId));
    state.selectedEntityIds = [...payload.entityIds];
    return;
  }
  if (payload.kind === "voxel.add") {
    addVoxels(page, state, payload.entityId, payload.cells);
    return;
  }
  if (payload.kind === "voxel.remove") {
    removeVoxels(page, state, payload.entityId, payload.cells);
    return;
  }
  if (payload.kind === "voxel.paint") {
    paintVoxels(page, state, payload.entityId, payload.cells, payload.directions, payload.materialToken);
    return;
  }
  if (payload.kind === "net.foldTo") {
    if (entity(page, payload.entityId).type !== "polyhedron") {
      fail(SPATIAL_RUNTIME_ERROR_CODES.referenceInvalid, `net fold entity must be polyhedron: ${payload.entityId}`);
    }
    const current = state.netFoldProgress.find((fold) => fold.entityId === payload.entityId);
    if (current) current.progress = payload.progress;
    else {
      state.netFoldProgress.push({ entityId: payload.entityId, progress: payload.progress });
      state.netFoldProgress.sort((left, right) => compareStableStrings(left.entityId, right.entityId));
    }
    return;
  }
  if (payload.kind === "section.plane.set") {
    entity(page, payload.targetEntityId);
    const guide = entity(page, payload.planeGuideId);
    if (guide.type !== "guide" || guide.definition.kind !== "plane") {
      fail(SPATIAL_RUNTIME_ERROR_CODES.referenceInvalid, `section guide must define a plane: ${payload.planeGuideId}`);
    }
    const current = state.sectionPlanes.find(
      (plane) => plane.targetEntityId === payload.targetEntityId && plane.planeGuideId === payload.planeGuideId,
    );
    const value = {
      targetEntityId: payload.targetEntityId,
      planeGuideId: payload.planeGuideId,
      normal: payload.normal,
      constant: payload.constant,
    };
    if (current) Object.assign(current, value);
    else {
      state.sectionPlanes.push(value);
      state.sectionPlanes.sort((left, right) =>
        compareStableStrings(
          `${left.targetEntityId}:${left.planeGuideId}`,
          `${right.targetEntityId}:${right.planeGuideId}`,
        ),
      );
    }
    return;
  }
  if (payload.kind === "parameter.set") {
    const definition = page.scene.model.parameters.find((parameter) => parameter.id === payload.parameterId);
    if (!definition) fail(SPATIAL_RUNTIME_ERROR_CODES.referenceInvalid, `unknown parameter: ${payload.parameterId}`);
    if (
      compareRationals(payload.value, definition.min) < 0 ||
      compareRationals(payload.value, definition.max) > 0 ||
      !rationalOnStep(payload.value, definition.min, definition.step)
    ) {
      fail(SPATIAL_RUNTIME_ERROR_CODES.operationInvalid, `parameter value is outside its legal step range: ${payload.parameterId}`);
    }
    const current = state.parameterValues.find((parameter) => parameter.parameterId === payload.parameterId);
    if (!current) fail(SPATIAL_RUNTIME_ERROR_CODES.referenceInvalid, `state parameter missing: ${payload.parameterId}`);
    current.value = payload.value;
    return;
  }
  if (payload.kind === "step.go") {
    const step = page.scene.sequence.steps.find((candidate) => candidate.id === payload.stepId);
    if (!step) fail(SPATIAL_RUNTIME_ERROR_CODES.referenceInvalid, `unknown step: ${payload.stepId}`);
    state.activeStepId = step.id;
    step.actions.forEach((action) => applyAuthoredAction(page, state, action));
    return;
  }
  if (payload.kind === "ownership.set") {
    if (!page.classroom.ownership.allowedModes.includes(payload.mode)) {
      fail(SPATIAL_RUNTIME_ERROR_CODES.ownershipNotAllowed, `ownership mode is not allowed: ${payload.mode}`);
    }
    state.ownershipMode = payload.mode;
    return;
  }
  if (payload.kind === "scene.reset") {
    fail(SPATIAL_RUNTIME_ERROR_CODES.operationInvalid, "scene.reset must be applied by the epoch transition");
  }
}

function applyAuthoredAction(page: SpatialPageDoc, state: SpatialRuntimeState, action: SpatialSceneAction): void {
  if (action.kind === "scene.reset") {
    resetMutableState(page, state, state.activeStepId);
    return;
  }
  const payload: SpatialCommandPayload =
    action.kind === "camera.apply"
      ? { kind: "camera.bookmark.apply", cameraId: action.cameraId }
      : action.kind === "entity.visibility.set"
        ? { kind: "visibility.set", entityIds: action.entityIds, visible: action.visible }
        : action;
  applyPayload(page, state, payload);
}

function authorizeCommand(state: SpatialRuntimeState, command: SpatialCommand): void {
  if (!branchEquals(state.branch, command.branch)) {
    fail(SPATIAL_RUNTIME_ERROR_CODES.branchMismatch, "command branch does not match runtime state branch");
  }
  if (state.branch.kind === "teacher-authority") {
    if (command.actor.kind !== "teacher-controller") {
      fail(SPATIAL_RUNTIME_ERROR_CODES.actorNotAllowed, "teacher authority branch requires the teacher controller");
    }
    return;
  }
  if (command.actor.kind !== "student" || command.actor.actorId !== state.branch.studentActorId) {
    fail(SPATIAL_RUNTIME_ERROR_CODES.actorNotAllowed, "student local branch requires its owning student actor");
  }
  if (state.ownershipMode !== "student-local-explore" && state.ownershipMode !== "student-submit") {
    fail(SPATIAL_RUNTIME_ERROR_CODES.ownershipNotAllowed, "student local commands require an open student mode");
  }
  if (command.payload.kind === "ownership.set" || command.payload.kind === "scene.reset") {
    fail(SPATIAL_RUNTIME_ERROR_CODES.actorNotAllowed, `student cannot issue ${command.payload.kind}`);
  }
}

export function createInitialSpatialRuntimeState(
  pageInput: unknown,
  branch: SpatialRuntimeBranch = { kind: "teacher-authority" },
): SpatialRuntimeState {
  const page = parseSpatialPageDoc(pageInput);
  let state = initialStateBody(page, branch);
  const initialStep = page.scene.sequence.initialStepId
    ? page.scene.sequence.steps.find((step) => step.id === page.scene.sequence.initialStepId)
    : undefined;
  if (initialStep) initialStep.actions.forEach((action) => applyAuthoredAction(page, state, action));
  state = validStateOrFail(state);
  validateStateReferences(page, state);
  return state;
}

export function forkStudentLocalRuntimeState(
  pageInput: unknown,
  authorityStateInput: unknown,
  studentActorId: string,
): SpatialRuntimeState {
  const page = parseSpatialPageDoc(pageInput);
  const authority = parseSpatialRuntimeState(authorityStateInput);
  if (authority.sceneRevisionHash !== page.sceneHash) {
    fail(SPATIAL_RUNTIME_ERROR_CODES.stateSceneMismatch, "runtime state scene hash does not match page scene hash");
  }
  if (authority.branch.kind !== "teacher-authority") {
    fail(SPATIAL_RUNTIME_ERROR_CODES.branchMismatch, "student branch must fork from teacher authority state");
  }
  validateStateReferences(page, authority);
  if (authority.ownershipMode !== "student-local-explore" && authority.ownershipMode !== "student-submit") {
    fail(SPATIAL_RUNTIME_ERROR_CODES.ownershipNotAllowed, "teacher has not opened a student mode");
  }
  return validStateOrFail({
    ...structuredClone(authority),
    branch: { kind: "student-local", studentActorId },
    lastAppliedSequence: 0,
    lastCommandId: null,
    lastCommandFingerprint: null,
  });
}

export function reduceSpatialRuntimeState(
  pageInput: unknown,
  stateInput: unknown,
  commandInput: unknown,
): SpatialRuntimeState {
  const page = parseSpatialPageDoc(pageInput);
  const state = parseSpatialRuntimeState(stateInput);
  const command = parseSpatialCommand(commandInput);

  if (state.sceneRevisionHash !== page.sceneHash) {
    fail(SPATIAL_RUNTIME_ERROR_CODES.stateSceneMismatch, "runtime state scene hash does not match page scene hash");
  }
  if (command.sceneRevisionHash !== page.sceneHash) {
    fail(SPATIAL_RUNTIME_ERROR_CODES.commandSceneMismatch, "command scene hash does not match page scene hash");
  }
  validateStateReferences(page, state);
  authorizeCommand(state, command);

  if (state.lastCommandId === command.commandId && state.lastAppliedSequence === command.sequence) {
    if (state.lastCommandFingerprint !== spatialCommandFingerprint(command)) {
      fail(SPATIAL_RUNTIME_ERROR_CODES.operationInvalid, "command id was reused with different content");
    }
    return state;
  }
  if (command.resetEpoch !== state.resetEpoch) {
    fail(SPATIAL_RUNTIME_ERROR_CODES.epochMismatch, "command reset epoch does not match runtime state");
  }
  if (command.sequence <= state.lastAppliedSequence) {
    fail(SPATIAL_RUNTIME_ERROR_CODES.staleSequence, "command sequence is stale");
  }
  if (command.sequence !== state.lastAppliedSequence + 1) {
    fail(SPATIAL_RUNTIME_ERROR_CODES.sequenceGap, "command sequence contains a gap");
  }

  if (command.payload.kind === "scene.reset") {
    let reset = initialStateBody(
      page,
      state.branch,
      page.classroom.ownership.defaultMode,
      state.resetEpoch + 1,
      command.sequence,
      command.commandId,
      spatialCommandFingerprint(command),
    );
    const initialStep = page.scene.sequence.initialStepId
      ? page.scene.sequence.steps.find((step) => step.id === page.scene.sequence.initialStepId)
      : undefined;
    if (initialStep) initialStep.actions.forEach((action) => applyAuthoredAction(page, reset, action));
    reset = validStateOrFail(reset);
    validateStateReferences(page, reset);
    return reset;
  }

  const next = structuredClone(state);
  applyPayload(page, next, command.payload);
  next.lastAppliedSequence = command.sequence;
  next.lastCommandId = command.commandId;
  next.lastCommandFingerprint = spatialCommandFingerprint(command);
  const parsed = validStateOrFail(next);
  validateStateReferences(page, parsed);
  return parsed;
}

export function spatialCommand(
  input: Omit<SpatialCommand, "commandVersion" | "delivery">,
): SpatialCommand {
  return parseSpatialCommand({
    ...input,
    commandVersion: SPATIAL_COMMAND_VERSION,
    delivery: "durable-semantic",
  });
}

export function spatialCommandFingerprint(commandInput: unknown): string {
  const command = parseSpatialCommand(commandInput);
  const bytes = new TextEncoder().encode(canonicalJsonStringify(command));
  let hash = BigInt("14695981039346656037");
  const prime = BigInt("1099511628211");
  bytes.forEach((byte) => {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  });
  return hash.toString(16).padStart(16, "0");
}

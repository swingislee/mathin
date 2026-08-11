import {
  materializeSpatialRuntimeVoxelEntity,
  parseSpatialPageDoc,
  parseSpatialRuntimeState,
  spatialAttemptResponseSchema,
  spatialCommandPayloadSchema,
  type SpatialCommandActor,
  type SpatialCommandPayload,
  type SpatialRuntimeState,
} from "../domain";

export const VOXEL_TEACHING_CONTROLLER_VERSION = "voxel-teaching-controller-v1" as const;
export type VoxelTeachingLocale = "zh" | "en";

export const VOXEL_TEACHING_CONTROLLER_ERROR_CODES = {
  entityNotVoxelSet: "VOXEL_TEACHING_ENTITY_NOT_VOXEL_SET",
  actorBranchMismatch: "VOXEL_TEACHING_ACTOR_BRANCH_MISMATCH",
  actionNotAllowed: "VOXEL_TEACHING_ACTION_NOT_ALLOWED",
  layerInvalid: "VOXEL_TEACHING_LAYER_INVALID",
  attemptInvalid: "VOXEL_TEACHING_ATTEMPT_INVALID",
} as const;

export type VoxelTeachingControllerErrorCode =
  (typeof VOXEL_TEACHING_CONTROLLER_ERROR_CODES)[keyof typeof VOXEL_TEACHING_CONTROLLER_ERROR_CODES];

export class VoxelTeachingControllerContractError extends Error {
  constructor(public readonly code: VoxelTeachingControllerErrorCode, message: string) {
    super(message);
    this.name = "VoxelTeachingControllerContractError";
  }
}

function fail(code: VoxelTeachingControllerErrorCode, message: string): never {
  throw new VoxelTeachingControllerContractError(code, message);
}

export interface VoxelTeachingStepView {
  readonly id: string;
  readonly index: number;
  readonly label: string;
  readonly teacherPrompt: string | null;
  readonly durationMs: number;
}

export interface VoxelTeachingCameraView {
  readonly id: string;
  readonly label: string;
  readonly projection: "orthographic" | "perspective";
}

export interface VoxelTeachingLayerView {
  readonly id: string;
  readonly label: string;
  readonly visible: boolean;
  readonly count: number | null;
}

export interface VoxelCountCheckpointView {
  readonly checkpointId: string;
  readonly prompt: string;
}

export interface VoxelTeachingControllerView {
  readonly controllerVersion: typeof VOXEL_TEACHING_CONTROLLER_VERSION;
  readonly entityId: string;
  readonly entityLabel: string;
  readonly ownershipMode: SpatialRuntimeState["ownershipMode"];
  readonly cameraId: string;
  readonly cameras: readonly VoxelTeachingCameraView[];
  readonly layers: readonly VoxelTeachingLayerView[];
  readonly steps: readonly VoxelTeachingStepView[];
  readonly activeStep: VoxelTeachingStepView | null;
  readonly totalCount: number | null;
  readonly countCheckpoint: VoxelCountCheckpointView | null;
  readonly canManipulateScene: boolean;
  readonly canSubmitCount: boolean;
  readonly canReset: boolean;
  readonly canGoPrevious: boolean;
  readonly canGoNext: boolean;
}

export type VoxelTeachingAction =
  | { readonly kind: "step.previous" }
  | { readonly kind: "step.next" }
  | { readonly kind: "step.go"; readonly stepId: string }
  | { readonly kind: "camera.apply"; readonly cameraId: string }
  | { readonly kind: "layer.toggle"; readonly layerId: string }
  | { readonly kind: "scene.reset" };

export interface VoxelCountAttemptDraft {
  readonly checkpointId: string;
  readonly response: { readonly kind: "numeric"; readonly value: { readonly numerator: number; readonly denominator: 1 } };
}

function localizedText(value: { readonly zh: string; readonly en?: string }, locale: VoxelTeachingLocale): string {
  return locale === "en" ? value.en ?? value.zh : value.zh;
}

function actorMatchesBranch(state: SpatialRuntimeState, actor: SpatialCommandActor): boolean {
  if (state.branch.kind === "teacher-authority") return actor.kind === "teacher-controller";
  return actor.kind === "student" && actor.actorId === state.branch.studentActorId;
}

function parsedInputs(pageInput: unknown, stateInput: unknown, entityId: string) {
  const page = parseSpatialPageDoc(pageInput);
  const state = parseSpatialRuntimeState(stateInput);
  const entity = page.scene.model.entities.find((candidate) => candidate.id === entityId);
  if (!entity || entity.type !== "voxel-set") {
    fail(VOXEL_TEACHING_CONTROLLER_ERROR_CODES.entityNotVoxelSet, `entity must be voxel-set: ${entityId}`);
  }
  const runtimeEntity = materializeSpatialRuntimeVoxelEntity(page, state, entityId);
  return { page, state, entity, runtimeEntity };
}

export function deriveVoxelTeachingControllerView(
  pageInput: unknown,
  stateInput: unknown,
  entityId: string,
  actor: SpatialCommandActor,
  locale: VoxelTeachingLocale,
  readOnly = false,
): VoxelTeachingControllerView {
  const { page, state, entity, runtimeEntity } = parsedInputs(pageInput, stateInput, entityId);
  const matchesBranch = actorMatchesBranch(state, actor);
  const studentModeOpen = state.ownershipMode === "student-local-explore" || state.ownershipMode === "student-submit";
  const canManipulateScene =
    !readOnly &&
    matchesBranch &&
    (actor.kind === "teacher-controller" || (actor.kind === "student" && studentModeOpen));
  const steps = page.scene.sequence.steps.map((step, index) => ({
    id: step.id,
    index,
    label: localizedText(step.title ?? { zh: step.id }, locale),
    teacherPrompt: step.teacherPrompt ? localizedText(step.teacherPrompt, locale) : null,
    durationMs: step.durationMs,
  }));
  const activeStepIndex = steps.findIndex((step) => step.id === state.activeStepId);
  const revealLayerCounts = state.activeStepId?.startsWith("step.layer.") || state.activeStepId === "step.verify";
  const checkpoint = page.scene.checkpoints.find(
    (item) =>
      item.type === "numeric" &&
      item.evaluator.kind === "derived" &&
      item.evaluator.query.kind === "voxel.total" &&
      item.evaluator.query.entityId === entityId,
  );
  const checkpointEnabled =
    checkpoint !== undefined &&
    page.learningCheck.mode === "formative-only" &&
    page.learningCheck.items.some((item) => item.checkpointId === checkpoint.id);
  const nextStep = activeStepIndex >= 0 ? steps[activeStepIndex + 1] : undefined;
  const studentSubmitRevealRestricted = actor.kind === "student" && state.ownershipMode === "student-submit";

  return {
    controllerVersion: VOXEL_TEACHING_CONTROLLER_VERSION,
    entityId,
    entityLabel: localizedText(entity.label ?? page.scene.title, locale),
    ownershipMode: state.ownershipMode,
    cameraId: state.cameraBookmarkId,
    cameras: page.scene.presentation.cameraBookmarks.map((camera) => ({
      id: camera.id,
      label: localizedText(camera.label, locale),
      projection: camera.projection,
    })),
    layers: runtimeEntity.layers.map((layer) => {
      const definition = page.scene.presentation.layers.find((candidate) => candidate.id === layer.layerId);
      return {
        id: layer.layerId,
        label: definition ? localizedText(definition.label, locale) : layer.layerId,
        visible: layer.visible,
        count: revealLayerCounts ? layer.cellCount : null,
      };
    }),
    steps,
    activeStep: activeStepIndex >= 0 ? steps[activeStepIndex] : null,
    totalCount: state.activeStepId === "step.verify" ? runtimeEntity.cells.length : null,
    countCheckpoint: checkpoint
      ? { checkpointId: checkpoint.id, prompt: localizedText(checkpoint.prompt, locale) }
      : null,
    canManipulateScene,
    canSubmitCount:
      canManipulateScene && actor.kind === "student" && state.ownershipMode === "student-submit" && checkpointEnabled,
    canReset: !readOnly && matchesBranch && actor.kind === "teacher-controller",
    canGoPrevious: canManipulateScene && activeStepIndex > 0,
    canGoNext:
      canManipulateScene &&
      activeStepIndex >= 0 &&
      activeStepIndex < steps.length - 1 &&
      !(studentSubmitRevealRestricted && nextStep?.id === "step.verify"),
  };
}

export function createVoxelTeachingCommandIntent(
  pageInput: unknown,
  stateInput: unknown,
  entityId: string,
  actor: SpatialCommandActor,
  locale: VoxelTeachingLocale,
  action: VoxelTeachingAction,
  readOnly = false,
): SpatialCommandPayload | null {
  const state = parseSpatialRuntimeState(stateInput);
  const view = deriveVoxelTeachingControllerView(pageInput, state, entityId, actor, locale, readOnly);
  if (action.kind === "scene.reset") {
    if (!view.canReset) fail(VOXEL_TEACHING_CONTROLLER_ERROR_CODES.actionNotAllowed, "only teacher authority can reset");
    return spatialCommandPayloadSchema.parse({ kind: "scene.reset" });
  }
  if (!view.canManipulateScene) {
    if (!actorMatchesBranch(state, actor)) {
      fail(VOXEL_TEACHING_CONTROLLER_ERROR_CODES.actorBranchMismatch, "actor does not own the runtime branch");
    }
    fail(VOXEL_TEACHING_CONTROLLER_ERROR_CODES.actionNotAllowed, "runtime branch is read-only");
  }
  if (action.kind === "camera.apply") {
    if (!view.cameras.some((camera) => camera.id === action.cameraId)) {
      fail(VOXEL_TEACHING_CONTROLLER_ERROR_CODES.actionNotAllowed, `unknown camera: ${action.cameraId}`);
    }
    return spatialCommandPayloadSchema.parse({ kind: "camera.bookmark.apply", cameraId: action.cameraId });
  }
  if (action.kind === "layer.toggle") {
    const layer = view.layers.find((candidate) => candidate.id === action.layerId);
    if (!layer) fail(VOXEL_TEACHING_CONTROLLER_ERROR_CODES.layerInvalid, `unknown voxel layer: ${action.layerId}`);
    return spatialCommandPayloadSchema.parse({ kind: "layer.set", layerId: layer.id, visible: !layer.visible });
  }
  const activeIndex = view.activeStep?.index ?? -1;
  const target =
    action.kind === "step.go"
      ? view.steps.find((step) => step.id === action.stepId)
      : action.kind === "step.previous"
        ? view.steps[activeIndex - 1]
        : view.steps[activeIndex + 1];
  if (!target) return null;
  if (actor.kind === "student" && state.ownershipMode === "student-submit" && target.id === "step.verify") {
    fail(VOXEL_TEACHING_CONTROLLER_ERROR_CODES.actionNotAllowed, "student submit branch cannot reveal the answer step");
  }
  return spatialCommandPayloadSchema.parse({ kind: "step.go", stepId: target.id });
}

export function createVoxelCountAttemptDraft(
  view: VoxelTeachingControllerView,
  rawValue: string,
): VoxelCountAttemptDraft {
  if (!view.canSubmitCount || !view.countCheckpoint) {
    fail(VOXEL_TEACHING_CONTROLLER_ERROR_CODES.actionNotAllowed, "count checkpoint is not open for this actor");
  }
  const normalized = rawValue.trim();
  if (!/^\d{1,9}$/.test(normalized)) {
    fail(VOXEL_TEACHING_CONTROLLER_ERROR_CODES.attemptInvalid, "count response must be a non-negative integer");
  }
  const value = Number(normalized);
  const response = spatialAttemptResponseSchema.parse({
    kind: "numeric",
    value: { numerator: value, denominator: 1 },
  });
  if (response.kind !== "numeric") throw new Error("numeric response parser returned another response kind");
  return {
    checkpointId: view.countCheckpoint.checkpointId,
    response: { kind: "numeric", value: { numerator: response.value.numerator, denominator: 1 } },
  };
}

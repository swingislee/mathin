import {
  parseSpatialPageDoc,
  parseSpatialRuntimeState,
  spatialCommandPayloadSchema,
  type SpatialCommandActor,
  type SpatialCommandPayload,
  type SpatialPageDoc,
  type SpatialRuntimeState,
} from "../domain";

export const POLYHEDRON_TEACHING_CONTROLLER_VERSION = "polyhedron-teaching-controller-v1" as const;

export type PolyhedronTeachingLocale = "zh" | "en";

export const POLYHEDRON_TEACHING_CONTROLLER_ERROR_CODES = {
  sceneMismatch: "POLYHEDRON_TEACHING_SCENE_MISMATCH",
  entityNotFoldable: "POLYHEDRON_TEACHING_ENTITY_NOT_FOLDABLE",
  stateReferenceInvalid: "POLYHEDRON_TEACHING_STATE_REFERENCE_INVALID",
  actorBranchMismatch: "POLYHEDRON_TEACHING_ACTOR_BRANCH_MISMATCH",
  actionNotAllowed: "POLYHEDRON_TEACHING_ACTION_NOT_ALLOWED",
  selectionInvalid: "POLYHEDRON_TEACHING_SELECTION_INVALID",
} as const;

export type PolyhedronTeachingControllerErrorCode =
  (typeof POLYHEDRON_TEACHING_CONTROLLER_ERROR_CODES)[keyof typeof POLYHEDRON_TEACHING_CONTROLLER_ERROR_CODES];

export class PolyhedronTeachingControllerError extends Error {
  constructor(public readonly code: PolyhedronTeachingControllerErrorCode, message: string) {
    super(message);
    this.name = "PolyhedronTeachingControllerError";
  }
}

export interface PolyhedronTeachingStepView {
  readonly id: string;
  readonly index: number;
  readonly label: string;
  readonly teacherPrompt: string | null;
  readonly announcement: string | null;
  readonly durationMs: number;
  readonly easing: "linear" | "ease-in-out";
}

export interface PolyhedronTeachingCameraView {
  readonly id: string;
  readonly label: string;
  readonly projection: "orthographic" | "perspective";
}

export interface PolyhedronTeachingFaceCheckpointView {
  readonly checkpointId: string;
  readonly prompt: string;
  readonly multiple: boolean;
  readonly options: readonly { readonly id: string; readonly label: string }[];
}

export interface PolyhedronTeachingControllerView {
  readonly controllerVersion: typeof POLYHEDRON_TEACHING_CONTROLLER_VERSION;
  readonly entityId: string;
  readonly entityLabel: string;
  readonly accessibilitySummary: string;
  readonly faceLabels: readonly { readonly id: string; readonly label: string }[];
  readonly ownershipMode: SpatialRuntimeState["ownershipMode"];
  readonly cameraId: string;
  readonly cameras: readonly PolyhedronTeachingCameraView[];
  readonly progress: number;
  readonly activeStep: PolyhedronTeachingStepView | null;
  readonly steps: readonly PolyhedronTeachingStepView[];
  readonly faceCheckpoint: PolyhedronTeachingFaceCheckpointView | null;
  readonly canManipulateScene: boolean;
  readonly canSelectFaces: boolean;
  readonly canSubmitFaceChoice: boolean;
  readonly canReset: boolean;
  readonly canGoPrevious: boolean;
  readonly canGoNext: boolean;
}

export type PolyhedronTeachingAction =
  | { readonly kind: "step.previous" }
  | { readonly kind: "step.next" }
  | { readonly kind: "step.go"; readonly stepId: string }
  | { readonly kind: "camera.apply"; readonly cameraId: string }
  | { readonly kind: "fold.set"; readonly progress: number }
  | { readonly kind: "scene.reset" };

export interface PolyhedronFaceAttemptDraft {
  readonly checkpointId: string;
  readonly response: {
    readonly kind: "choice";
    readonly optionIds: readonly string[];
  };
}

interface LocalizedText {
  readonly zh: string;
  readonly en?: string;
}

function localizedText(value: LocalizedText | undefined, locale: PolyhedronTeachingLocale, fallback: string): string {
  if (!value) return fallback;
  return locale === "en" ? value.en ?? value.zh : value.zh;
}

function fail(code: PolyhedronTeachingControllerErrorCode, message: string): never {
  throw new PolyhedronTeachingControllerError(code, message);
}

function actorMatchesBranch(state: SpatialRuntimeState, actor: SpatialCommandActor): boolean {
  if (actor.kind === "teacher-controller") return state.branch.kind === "teacher-authority";
  return state.branch.kind === "student-local" && state.branch.studentActorId === actor.actorId;
}

function parsedControllerInputs(pageInput: unknown, stateInput: unknown, entityId: string) {
  const page = parseSpatialPageDoc(pageInput);
  const state = parseSpatialRuntimeState(stateInput);
  if (state.sceneRevisionHash !== page.sceneHash) {
    fail(
      POLYHEDRON_TEACHING_CONTROLLER_ERROR_CODES.sceneMismatch,
      "runtime state scene hash does not match the spatial page",
    );
  }
  const entity = page.scene.model.entities.find((candidate) => candidate.id === entityId);
  if (!entity || entity.type !== "polyhedron" || !entity.folding) {
    fail(
      POLYHEDRON_TEACHING_CONTROLLER_ERROR_CODES.entityNotFoldable,
      `spatial page entity is not foldable: ${entityId}`,
    );
  }
  const folding = entity.folding;
  if (!page.classroom.ownership.allowedModes.includes(state.ownershipMode)) {
    fail(
      POLYHEDRON_TEACHING_CONTROLLER_ERROR_CODES.stateReferenceInvalid,
      `runtime ownership mode is not allowed: ${state.ownershipMode}`,
    );
  }
  if (!page.scene.presentation.cameraBookmarks.some((camera) => camera.id === state.cameraBookmarkId)) {
    fail(
      POLYHEDRON_TEACHING_CONTROLLER_ERROR_CODES.stateReferenceInvalid,
      `runtime camera bookmark does not exist: ${state.cameraBookmarkId}`,
    );
  }
  if (state.activeStepId && !page.scene.sequence.steps.some((step) => step.id === state.activeStepId)) {
    fail(
      POLYHEDRON_TEACHING_CONTROLLER_ERROR_CODES.stateReferenceInvalid,
      `runtime step does not exist: ${state.activeStepId}`,
    );
  }
  return { page, state, entity, folding };
}

function faceCheckpoint(page: SpatialPageDoc, entityId: string, locale: PolyhedronTeachingLocale) {
  const entity = page.scene.model.entities.find((candidate) => candidate.id === entityId);
  if (!entity || entity.type !== "polyhedron" || !entity.folding) return null;
  const faceIds = new Set(entity.folding.topology.faces.map((face) => face.id));
  const checkpoint = page.scene.checkpoints.find(
    (candidate) => candidate.type === "choice" && candidate.options.every((option) => faceIds.has(option.id)),
  );
  if (!checkpoint || checkpoint.type !== "choice") return null;
  return {
    checkpointId: checkpoint.id,
    prompt: localizedText(checkpoint.prompt, locale, checkpoint.id),
    multiple: checkpoint.multiple,
    options: checkpoint.options.map((option) => ({
      id: option.id,
      label: localizedText(option.label, locale, option.id),
    })),
  } satisfies PolyhedronTeachingFaceCheckpointView;
}

function stepViews(page: SpatialPageDoc, locale: PolyhedronTeachingLocale): readonly PolyhedronTeachingStepView[] {
  return page.scene.sequence.steps.map((step, index) => ({
    id: step.id,
    index,
    label: localizedText(step.title, locale, step.id),
    teacherPrompt: step.teacherPrompt ? localizedText(step.teacherPrompt, locale, step.id) : null,
    announcement: step.announce ? localizedText(step.announce, locale, step.id) : null,
    durationMs: step.transition === "none" ? 0 : step.durationMs,
    easing: step.transition === "ease-in-out" ? "ease-in-out" : "linear",
  }));
}

export function derivePolyhedronTeachingControllerView(
  pageInput: unknown,
  stateInput: unknown,
  entityId: string,
  actor: SpatialCommandActor,
  locale: PolyhedronTeachingLocale,
  readOnly = false,
): PolyhedronTeachingControllerView {
  const { page, state, entity, folding } = parsedControllerInputs(pageInput, stateInput, entityId);
  const matchesBranch = actorMatchesBranch(state, actor);
  const studentModeOpen = state.ownershipMode === "student-local-explore" || state.ownershipMode === "student-submit";
  const canManipulateScene =
    !readOnly &&
    matchesBranch &&
    (actor.kind === "teacher-controller" || (actor.kind === "student" && studentModeOpen));
  const steps = stepViews(page, locale);
  const activeStepIndex = state.activeStepId ? steps.findIndex((step) => step.id === state.activeStepId) : -1;
  const checkpoint = faceCheckpoint(page, entityId, locale);
  const checkpointEnabled =
    checkpoint !== null &&
    page.learningCheck.mode === "formative-only" &&
    page.learningCheck.items.some((item) => item.checkpointId === checkpoint.checkpointId);
  const canSelectFaces = canManipulateScene && checkpoint !== null;
  return {
    controllerVersion: POLYHEDRON_TEACHING_CONTROLLER_VERSION,
    entityId,
    entityLabel: localizedText(entity.label, locale, entityId),
    accessibilitySummary: localizedText(folding.fallback.summary, locale, entityId),
    faceLabels: folding.fallback.faceLabels.map((face) => ({
      id: face.faceId,
      label: localizedText(face.label, locale, face.faceId),
    })),
    ownershipMode: state.ownershipMode,
    cameraId: state.cameraBookmarkId,
    cameras: page.scene.presentation.cameraBookmarks.map((camera) => ({
      id: camera.id,
      label: localizedText(camera.label, locale, camera.id),
      projection: camera.projection,
    })),
    progress: state.netFoldProgress.find((entry) => entry.entityId === entityId)?.progress ?? 0,
    activeStep: activeStepIndex >= 0 ? steps[activeStepIndex] : null,
    steps,
    faceCheckpoint: checkpoint,
    canManipulateScene,
    canSelectFaces,
    canSubmitFaceChoice:
      canSelectFaces && actor.kind === "student" && state.ownershipMode === "student-submit" && checkpointEnabled,
    canReset: !readOnly && matchesBranch && actor.kind === "teacher-controller",
    canGoPrevious: canManipulateScene && activeStepIndex > 0,
    canGoNext: canManipulateScene && activeStepIndex >= 0 && activeStepIndex < steps.length - 1,
  };
}

export function createPolyhedronTeachingCommandIntent(
  pageInput: unknown,
  stateInput: unknown,
  entityId: string,
  actor: SpatialCommandActor,
  action: PolyhedronTeachingAction,
): SpatialCommandPayload | null {
  const view = derivePolyhedronTeachingControllerView(pageInput, stateInput, entityId, actor, "zh");
  if (action.kind === "scene.reset") {
    if (!view.canReset) {
      fail(POLYHEDRON_TEACHING_CONTROLLER_ERROR_CODES.actionNotAllowed, "only the teacher authority can reset the scene");
    }
    return spatialCommandPayloadSchema.parse({ kind: "scene.reset" });
  }
  if (!view.canManipulateScene) {
    if (!actorMatchesBranch(parseSpatialRuntimeState(stateInput), actor)) {
      fail(
        POLYHEDRON_TEACHING_CONTROLLER_ERROR_CODES.actorBranchMismatch,
        "teaching actor does not match the runtime branch",
      );
    }
    fail(POLYHEDRON_TEACHING_CONTROLLER_ERROR_CODES.actionNotAllowed, "scene manipulation is not allowed in this mode");
  }
  if (action.kind === "step.previous" || action.kind === "step.next") {
    const currentIndex = view.activeStep?.index ?? -1;
    const nextIndex = action.kind === "step.previous" ? currentIndex - 1 : currentIndex + 1;
    const nextStep = view.steps[nextIndex];
    return nextStep ? spatialCommandPayloadSchema.parse({ kind: "step.go", stepId: nextStep.id }) : null;
  }
  if (action.kind === "step.go") {
    if (!view.steps.some((step) => step.id === action.stepId)) {
      fail(
        POLYHEDRON_TEACHING_CONTROLLER_ERROR_CODES.stateReferenceInvalid,
        `unknown authored teaching step: ${action.stepId}`,
      );
    }
    return spatialCommandPayloadSchema.parse({ kind: "step.go", stepId: action.stepId });
  }
  if (action.kind === "camera.apply") {
    if (!view.cameras.some((camera) => camera.id === action.cameraId)) {
      fail(
        POLYHEDRON_TEACHING_CONTROLLER_ERROR_CODES.stateReferenceInvalid,
        `unknown authored camera bookmark: ${action.cameraId}`,
      );
    }
    return spatialCommandPayloadSchema.parse({ kind: "camera.bookmark.apply", cameraId: action.cameraId });
  }
  return spatialCommandPayloadSchema.parse({ kind: "net.foldTo", entityId, progress: action.progress });
}

export function nextPolyhedronFaceSelection(
  view: PolyhedronTeachingControllerView,
  selectedFaceIds: readonly string[],
  faceId: string,
): readonly string[] {
  const checkpoint = view.faceCheckpoint;
  if (!view.canSelectFaces || !checkpoint) {
    fail(POLYHEDRON_TEACHING_CONTROLLER_ERROR_CODES.actionNotAllowed, "face selection is not available in this mode");
  }
  const optionIds = checkpoint.options.map((option) => option.id);
  if (!optionIds.includes(faceId)) {
    fail(POLYHEDRON_TEACHING_CONTROLLER_ERROR_CODES.selectionInvalid, `face is not a checkpoint option: ${faceId}`);
  }
  if (!checkpoint.multiple) return [faceId];
  const next = new Set(selectedFaceIds);
  if (next.has(faceId)) next.delete(faceId);
  else next.add(faceId);
  return optionIds.filter((optionId) => next.has(optionId));
}

export function createPolyhedronFaceAttemptDraft(
  view: PolyhedronTeachingControllerView,
  selectedFaceIds: readonly string[],
): PolyhedronFaceAttemptDraft {
  const checkpoint = view.faceCheckpoint;
  if (!view.canSubmitFaceChoice || !checkpoint) {
    fail(POLYHEDRON_TEACHING_CONTROLLER_ERROR_CODES.actionNotAllowed, "face choice submission is not available in this mode");
  }
  const allowed = new Set(checkpoint.options.map((option) => option.id));
  const optionIds = [...new Set(selectedFaceIds)].sort();
  if (optionIds.length === 0 || optionIds.some((optionId) => !allowed.has(optionId))) {
    fail(POLYHEDRON_TEACHING_CONTROLLER_ERROR_CODES.selectionInvalid, "face choice contains an unknown or empty selection");
  }
  if (!checkpoint.multiple && optionIds.length !== 1) {
    fail(POLYHEDRON_TEACHING_CONTROLLER_ERROR_CODES.selectionInvalid, "single-choice checkpoint requires one face");
  }
  return {
    checkpointId: checkpoint.checkpointId,
    response: { kind: "choice", optionIds },
  };
}

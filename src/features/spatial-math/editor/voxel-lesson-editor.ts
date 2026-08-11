import {
  VOXEL_LESSON_CAMERAS,
  VOXEL_LESSON_LIMITS,
  canonicalJsonStringify,
  createDefaultVoxelLessonPlan,
  parseVoxelLessonPlan,
  type VoxelLessonCamera,
  type VoxelLessonPlan,
  type VoxelLessonStep,
} from "../domain";

export const VOXEL_LESSON_EDITOR_VERSION = "voxel-lesson-editor-v1" as const;

const MAX_HISTORY = 50;

interface VoxelLessonEditorSnapshot {
  readonly plan: VoxelLessonPlan;
  readonly selectedStepId: string;
}

export interface VoxelLessonEditorState {
  readonly editorVersion: typeof VOXEL_LESSON_EDITOR_VERSION;
  readonly plan: VoxelLessonPlan;
  readonly initial: VoxelLessonEditorSnapshot;
  readonly selectedStepId: string;
  readonly past: readonly VoxelLessonEditorSnapshot[];
  readonly future: readonly VoxelLessonEditorSnapshot[];
}

export type VoxelLessonEditorAction =
  | { readonly kind: "step.select"; readonly stepId: string }
  | { readonly kind: "step.add-view"; readonly camera: VoxelLessonCamera }
  | { readonly kind: "step.move"; readonly stepId: string; readonly direction: "up" | "down" }
  | { readonly kind: "step.remove"; readonly stepId: string }
  | {
      readonly kind: "step.text.set";
      readonly stepId: string;
      readonly field: "title" | "teacherPrompt";
      readonly locale: "zh" | "en";
      readonly value: string;
    }
  | { readonly kind: "layers.order.set"; readonly order: "ascending" | "descending" }
  | { readonly kind: "checkpoint.prompt.set"; readonly locale: "zh" | "en"; readonly value: string }
  | { readonly kind: "checkpoint.required.toggle" }
  | { readonly kind: "checkpoint.max-submissions.set"; readonly value: number }
  | { readonly kind: "history.undo" }
  | { readonly kind: "history.redo" }
  | { readonly kind: "draft.reset" };

export interface VoxelLessonEditorStepView {
  readonly id: string;
  readonly kind: VoxelLessonStep["kind"];
  readonly camera: VoxelLessonCamera | null;
  readonly index: number;
  readonly title: VoxelLessonStep["title"];
  readonly teacherPrompt: VoxelLessonStep["teacherPrompt"];
  readonly selected: boolean;
  readonly fixed: boolean;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly canRemove: boolean;
}

export interface VoxelLessonEditorView {
  readonly editorVersion: typeof VOXEL_LESSON_EDITOR_VERSION;
  readonly steps: readonly VoxelLessonEditorStepView[];
  readonly selectedStep: VoxelLessonEditorStepView;
  readonly checkpoint: VoxelLessonPlan["checkpoint"];
  readonly canAddView: boolean;
  readonly availableCameras: readonly VoxelLessonCamera[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly isDirty: boolean;
}

export const VOXEL_LESSON_EDITOR_ERROR_CODES = {
  stepUnknown: "VOXEL_LESSON_EDITOR_STEP_UNKNOWN",
  fixedStep: "VOXEL_LESSON_EDITOR_FIXED_STEP",
  observationRequired: "VOXEL_LESSON_EDITOR_OBSERVATION_REQUIRED",
  stepLimit: "VOXEL_LESSON_EDITOR_STEP_LIMIT",
  textInvalid: "VOXEL_LESSON_EDITOR_TEXT_INVALID",
  checkpointInvalid: "VOXEL_LESSON_EDITOR_CHECKPOINT_INVALID",
} as const;

export type VoxelLessonEditorErrorCode =
  (typeof VOXEL_LESSON_EDITOR_ERROR_CODES)[keyof typeof VOXEL_LESSON_EDITOR_ERROR_CODES];

export class VoxelLessonEditorError extends Error {
  constructor(public readonly code: VoxelLessonEditorErrorCode, message: string) {
    super(message);
    this.name = "VoxelLessonEditorError";
  }
}

function fail(code: VoxelLessonEditorErrorCode, message: string): never {
  throw new VoxelLessonEditorError(code, message);
}

function clonePlan(plan: VoxelLessonPlan): VoxelLessonPlan {
  return structuredClone(plan);
}

function snapshot(state: Pick<VoxelLessonEditorState, "plan" | "selectedStepId">): VoxelLessonEditorSnapshot {
  return { plan: clonePlan(state.plan), selectedStepId: state.selectedStepId };
}

function commit(
  state: VoxelLessonEditorState,
  planValue: unknown,
  selectedStepId = state.selectedStepId,
): VoxelLessonEditorState {
  const plan = parseVoxelLessonPlan(planValue);
  if (!plan.steps.some((step) => step.id === selectedStepId)) {
    fail(VOXEL_LESSON_EDITOR_ERROR_CODES.stepUnknown, `unknown selected lesson step: ${selectedStepId}`);
  }
  if (canonicalJsonStringify(plan) === canonicalJsonStringify(state.plan)) {
    return selectedStepId === state.selectedStepId ? state : { ...state, selectedStepId };
  }
  return {
    ...state,
    plan,
    selectedStepId,
    past: [...state.past, snapshot(state)].slice(-MAX_HISTORY),
    future: [],
  };
}

function stepOrFail(plan: VoxelLessonPlan, stepId: string): VoxelLessonStep {
  const step = plan.steps.find((candidate) => candidate.id === stepId);
  if (!step) fail(VOXEL_LESSON_EDITOR_ERROR_CODES.stepUnknown, `unknown lesson step: ${stepId}`);
  return step;
}

function nextViewId(plan: VoxelLessonPlan): string {
  const used = new Set(plan.steps.map((step) => step.id));
  for (let index = 1; index <= VOXEL_LESSON_LIMITS.maxLogicalSteps; index += 1) {
    const id = `step.view.${String(index).padStart(3, "0")}`;
    if (!used.has(id)) return id;
  }
  fail(VOXEL_LESSON_EDITOR_ERROR_CODES.stepLimit, "no stable view step id remains");
}

function defaultViewStep(camera: VoxelLessonCamera, id: string): VoxelLessonStep {
  const content: Readonly<Record<VoxelLessonCamera, { title: { zh: string; en: string }; prompt: { zh: string; en: string } }>> = {
    front: {
      title: { zh: "观察正面", en: "Observe the front" },
      prompt: { zh: "正面看到了哪些方格？", en: "Which squares are visible from the front?" },
    },
    right: {
      title: { zh: "观察右面", en: "Observe the right" },
      prompt: { zh: "右面视图与正面有什么不同？", en: "How does the right view differ from the front?" },
    },
    top: {
      title: { zh: "观察上面", en: "Observe the top" },
      prompt: { zh: "从上面能判断每列有多高吗？", en: "Can the top view tell how tall each stack is?" },
    },
  };
  return {
    id,
    kind: "view",
    camera,
    title: content[camera].title,
    teacherPrompt: content[camera].prompt,
  };
}

function updatedLocalizedText(
  current: { readonly zh: string; readonly en?: string } | undefined,
  locale: "zh" | "en",
  rawValue: string,
) {
  const value = rawValue.trim();
  if (locale === "zh") {
    if (!value) fail(VOXEL_LESSON_EDITOR_ERROR_CODES.textInvalid, "Chinese lesson text cannot be empty");
    return { zh: value, ...(current?.en ? { en: current.en } : {}) };
  }
  if (!current?.zh) {
    fail(VOXEL_LESSON_EDITOR_ERROR_CODES.textInvalid, "Chinese lesson text is required before English");
  }
  return value ? { zh: current.zh, en: value } : { zh: current.zh };
}

function updatedOptionalLocalizedText(
  current: { readonly zh: string; readonly en?: string } | undefined,
  locale: "zh" | "en",
  rawValue: string,
) {
  const value = rawValue.trim();
  if (locale === "zh") {
    if (!value) return undefined;
    return { zh: value, ...(current?.en ? { en: current.en } : {}) };
  }
  if (!current?.zh) {
    if (!value) return undefined;
    fail(VOXEL_LESSON_EDITOR_ERROR_CODES.textInvalid, "Chinese teacher prompt is required before English");
  }
  return value ? { zh: current.zh, en: value } : { zh: current.zh };
}

export function createVoxelLessonEditorState(
  planValue?: unknown,
  teacherPrompt: { readonly zh: string; readonly en?: string } = {
    zh: "先估一估，再找出可能被挡住的单位块。",
    en: "Estimate first, then find cubes that may be hidden.",
  },
): VoxelLessonEditorState {
  const plan = planValue === undefined
    ? createDefaultVoxelLessonPlan(teacherPrompt)
    : parseVoxelLessonPlan(planValue);
  const selectedStepId = plan.steps[0].id;
  const initial = { plan: clonePlan(plan), selectedStepId };
  return {
    editorVersion: VOXEL_LESSON_EDITOR_VERSION,
    plan,
    initial,
    selectedStepId,
    past: [],
    future: [],
  };
}

export function applyVoxelLessonEditorAction(
  state: VoxelLessonEditorState,
  action: VoxelLessonEditorAction,
): VoxelLessonEditorState {
  if (action.kind === "step.select") {
    stepOrFail(state.plan, action.stepId);
    return { ...state, selectedStepId: action.stepId };
  }

  if (action.kind === "step.add-view") {
    if (!VOXEL_LESSON_CAMERAS.includes(action.camera)) {
      fail(VOXEL_LESSON_EDITOR_ERROR_CODES.stepUnknown, `unsupported lesson camera: ${action.camera}`);
    }
    if (state.plan.steps.length >= VOXEL_LESSON_LIMITS.maxLogicalSteps) {
      fail(VOXEL_LESSON_EDITOR_ERROR_CODES.stepLimit, "lesson reached its logical step limit");
    }
    if (state.plan.steps.some((step) => step.kind === "view" && step.camera === action.camera)) {
      return state;
    }
    const id = nextViewId(state.plan);
    const layerIndex = state.plan.steps.findIndex((step) => step.kind === "layer-scan");
    const steps = [
      ...state.plan.steps.slice(0, layerIndex),
      defaultViewStep(action.camera, id),
      ...state.plan.steps.slice(layerIndex),
    ];
    return commit(state, { ...state.plan, steps }, id);
  }

  if (action.kind === "step.move") {
    const index = state.plan.steps.findIndex((step) => step.id === action.stepId);
    if (index < 0) fail(VOXEL_LESSON_EDITOR_ERROR_CODES.stepUnknown, `unknown lesson step: ${action.stepId}`);
    if (state.plan.steps[index]?.kind !== "view") {
      fail(VOXEL_LESSON_EDITOR_ERROR_CODES.fixedStep, "only authored view phases can move");
    }
    const target = action.direction === "up" ? index - 1 : index + 1;
    if (state.plan.steps[target]?.kind !== "view") return state;
    const steps = [...state.plan.steps];
    [steps[index], steps[target]] = [steps[target], steps[index]];
    return commit(state, { ...state.plan, steps }, action.stepId);
  }

  if (action.kind === "step.remove") {
    const step = stepOrFail(state.plan, action.stepId);
    if (step.kind !== "view") {
      fail(VOXEL_LESSON_EDITOR_ERROR_CODES.fixedStep, "only authored view phases can be removed");
    }
    const remaining = state.plan.steps.filter((candidate) => candidate.id !== action.stepId);
    if (!remaining.some((candidate) => candidate.kind === "view")) {
      fail(VOXEL_LESSON_EDITOR_ERROR_CODES.observationRequired, "lesson requires an authored view");
    }
    const nextSelection = remaining[Math.min(state.plan.steps.indexOf(step), remaining.length - 1)].id;
    return commit(state, { ...state.plan, steps: remaining }, nextSelection);
  }

  if (action.kind === "step.text.set") {
    stepOrFail(state.plan, action.stepId);
    const steps = state.plan.steps.map((step) => {
      if (step.id !== action.stepId) return step;
      if (action.field === "title") {
        return { ...step, title: updatedLocalizedText(step.title, action.locale, action.value) };
      }
      return {
        ...step,
        teacherPrompt: updatedOptionalLocalizedText(step.teacherPrompt, action.locale, action.value),
      };
    });
    return commit(state, { ...state.plan, steps }, action.stepId);
  }

  if (action.kind === "layers.order.set") {
    const current = state.plan.steps.find((step) => step.kind === "layer-scan");
    if (current?.order === action.order) return state;
    const steps = state.plan.steps.map((step) =>
      step.kind === "layer-scan" ? { ...step, order: action.order } : step,
    );
    return commit(state, { ...state.plan, steps });
  }

  if (action.kind === "checkpoint.required.toggle") {
    return commit(state, {
      ...state.plan,
      checkpoint: { ...state.plan.checkpoint, required: !state.plan.checkpoint.required },
    });
  }

  if (action.kind === "checkpoint.max-submissions.set") {
    if (!Number.isInteger(action.value) || action.value < 1 || action.value > 10) {
      fail(VOXEL_LESSON_EDITOR_ERROR_CODES.checkpointInvalid, "checkpoint submissions must be from 1 to 10");
    }
    return commit(state, {
      ...state.plan,
      checkpoint: { ...state.plan.checkpoint, maxSubmissions: action.value },
    });
  }

  if (action.kind === "checkpoint.prompt.set") {
    return commit(state, {
      ...state.plan,
      checkpoint: {
        ...state.plan.checkpoint,
        prompt: updatedLocalizedText(state.plan.checkpoint.prompt, action.locale, action.value),
      },
    });
  }

  if (action.kind === "history.undo") {
    const previous = state.past.at(-1);
    if (!previous) return state;
    return {
      ...state,
      plan: clonePlan(previous.plan),
      selectedStepId: previous.selectedStepId,
      past: state.past.slice(0, -1),
      future: [snapshot(state), ...state.future].slice(0, MAX_HISTORY),
    };
  }

  if (action.kind === "history.redo") {
    const next = state.future[0];
    if (!next) return state;
    return {
      ...state,
      plan: clonePlan(next.plan),
      selectedStepId: next.selectedStepId,
      past: [...state.past, snapshot(state)].slice(-MAX_HISTORY),
      future: state.future.slice(1),
    };
  }

  if (canonicalJsonStringify(state.plan) === canonicalJsonStringify(state.initial.plan)) return state;
  return {
    ...state,
    plan: clonePlan(state.initial.plan),
    selectedStepId: state.initial.selectedStepId,
    past: [...state.past, snapshot(state)].slice(-MAX_HISTORY),
    future: [],
  };
}

export function deriveVoxelLessonEditorView(state: VoxelLessonEditorState): VoxelLessonEditorView {
  const viewCount = state.plan.steps.filter((step) => step.kind === "view").length;
  const steps = state.plan.steps.map((step, index) => {
    const fixed = step.kind !== "view";
    return {
      id: step.id,
      kind: step.kind,
      camera: step.kind === "view" ? step.camera : null,
      index,
      title: step.title,
      teacherPrompt: step.teacherPrompt,
      selected: step.id === state.selectedStepId,
      fixed,
      canMoveUp: step.kind === "view" && state.plan.steps[index - 1]?.kind === "view",
      canMoveDown: step.kind === "view" && state.plan.steps[index + 1]?.kind === "view",
      canRemove: step.kind === "view" && viewCount > 1,
    };
  });
  const selectedStep = steps.find((step) => step.selected);
  if (!selectedStep) fail(VOXEL_LESSON_EDITOR_ERROR_CODES.stepUnknown, "selected lesson step is missing");
  return {
    editorVersion: VOXEL_LESSON_EDITOR_VERSION,
    steps,
    selectedStep,
    checkpoint: state.plan.checkpoint,
    canAddView:
      state.plan.steps.length < VOXEL_LESSON_LIMITS.maxLogicalSteps &&
      viewCount < VOXEL_LESSON_CAMERAS.length,
    availableCameras: VOXEL_LESSON_CAMERAS.filter(
      (camera) => !state.plan.steps.some((step) => step.kind === "view" && step.camera === camera),
    ),
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    isDirty: canonicalJsonStringify(state.plan) !== canonicalJsonStringify(state.initial.plan),
  };
}

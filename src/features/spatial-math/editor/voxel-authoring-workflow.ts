import {
  buildVoxelAuthoringPage,
  createDefaultVoxelAuthoringDraft,
  parseVoxelAuthoringDraft,
  replaceVoxelAuthoringLesson,
  replaceVoxelAuthoringModel,
  type VoxelAuthoringDraft,
  type VoxelLessonPageBuildResult,
} from "../domain";
import {
  applyVoxelLessonEditorAction,
  createVoxelLessonEditorState,
  type VoxelLessonEditorAction,
  type VoxelLessonEditorState,
} from "./voxel-lesson-editor";
import {
  applyVoxelTemplateEditorAction,
  createVoxelTemplateEditorState,
  type VoxelTemplateEditorAction,
  type VoxelTemplateEditorBounds,
  type VoxelTemplateEditorState,
} from "./voxel-template-editor";

export const VOXEL_AUTHORING_WORKFLOW_VERSION = "voxel-authoring-workflow-v1" as const;

export type VoxelAuthoringWorkflowPanel = "model" | "lesson";

export interface VoxelAuthoringWorkflowState {
  readonly workflowVersion: typeof VOXEL_AUTHORING_WORKFLOW_VERSION;
  readonly panel: VoxelAuthoringWorkflowPanel;
  readonly draft: VoxelAuthoringDraft;
  readonly modelEditor: VoxelTemplateEditorState;
  readonly lessonEditor: VoxelLessonEditorState;
}

export type VoxelAuthoringWorkflowAction =
  | { readonly kind: "panel.select"; readonly panel: VoxelAuthoringWorkflowPanel }
  | { readonly kind: "model.apply"; readonly action: VoxelTemplateEditorAction }
  | { readonly kind: "lesson.apply"; readonly action: VoxelLessonEditorAction };

export function createVoxelAuthoringWorkflowState(
  draftValue: unknown,
  boundsValue?: VoxelTemplateEditorBounds,
): VoxelAuthoringWorkflowState {
  const draft = parseVoxelAuthoringDraft(draftValue);
  const modelEditor = createVoxelTemplateEditorState(draft.model, boundsValue);
  const lessonEditor = createVoxelLessonEditorState(draft.lesson, draft.model.teacherPrompt);
  return {
    workflowVersion: VOXEL_AUTHORING_WORKFLOW_VERSION,
    panel: "model",
    draft,
    modelEditor,
    lessonEditor,
  };
}

export function createDefaultVoxelAuthoringWorkflowState(
  modelValue: unknown,
  boundsValue?: VoxelTemplateEditorBounds,
): VoxelAuthoringWorkflowState {
  return createVoxelAuthoringWorkflowState(
    createDefaultVoxelAuthoringDraft(modelValue),
    boundsValue,
  );
}

function alignModelEditor(
  editor: VoxelTemplateEditorState,
  draft: VoxelAuthoringDraft,
): VoxelTemplateEditorState {
  return editor.draft === draft.model ? editor : { ...editor, draft: draft.model };
}

function alignLessonEditor(
  editor: VoxelLessonEditorState,
  draft: VoxelAuthoringDraft,
): VoxelLessonEditorState {
  return editor.plan === draft.lesson ? editor : { ...editor, plan: draft.lesson };
}

export function applyVoxelAuthoringWorkflowAction(
  state: VoxelAuthoringWorkflowState,
  action: VoxelAuthoringWorkflowAction,
): VoxelAuthoringWorkflowState {
  if (action.kind === "panel.select") {
    return action.panel === state.panel ? state : { ...state, panel: action.panel };
  }

  if (action.kind === "model.apply") {
    const modelEditor = applyVoxelTemplateEditorAction(state.modelEditor, action.action);
    if (modelEditor === state.modelEditor) return state;
    if (modelEditor.draft === state.modelEditor.draft) {
      return { ...state, modelEditor };
    }
    const draft = replaceVoxelAuthoringModel(state.draft, modelEditor.draft);
    return {
      ...state,
      draft,
      modelEditor: alignModelEditor(modelEditor, draft),
      lessonEditor: alignLessonEditor(state.lessonEditor, draft),
    };
  }

  const lessonEditor = applyVoxelLessonEditorAction(state.lessonEditor, action.action);
  if (lessonEditor === state.lessonEditor) return state;
  if (lessonEditor.plan === state.lessonEditor.plan) {
    return { ...state, lessonEditor };
  }
  const draft = replaceVoxelAuthoringLesson(state.draft, lessonEditor.plan);
  return {
    ...state,
    draft,
    modelEditor: alignModelEditor(state.modelEditor, draft),
    lessonEditor: alignLessonEditor(lessonEditor, draft),
  };
}

export function buildVoxelAuthoringWorkflowPage(
  state: VoxelAuthoringWorkflowState,
): Promise<VoxelLessonPageBuildResult> {
  return buildVoxelAuthoringPage(state.draft);
}

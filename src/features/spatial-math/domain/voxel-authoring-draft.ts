import { canonicalSha256 } from "./canonical-json";
import {
  buildVoxelLessonPage,
  type VoxelLessonPageBuildResult,
} from "./voxel-lesson-adapter";
import {
  createDefaultVoxelLessonPlan,
  parseVoxelLessonPlan,
} from "./voxel-lesson-schema";
import {
  parseVoxelSceneAdapterInput,
} from "./voxel-scene-adapter-schema";
import {
  parseVoxelAuthoringDraft,
  VOXEL_AUTHORING_DRAFT_VERSION,
  type VoxelAuthoringDraft,
} from "./voxel-authoring-draft-schema";

export function createDefaultVoxelAuthoringDraft(modelValue: unknown): VoxelAuthoringDraft {
  const model = parseVoxelSceneAdapterInput(modelValue);
  return parseVoxelAuthoringDraft({
    draftVersion: VOXEL_AUTHORING_DRAFT_VERSION,
    model,
    lesson: createDefaultVoxelLessonPlan(model.teacherPrompt),
  });
}

/**
 * Replaces model data without creating a second prompt authority. Once a draft
 * exists, the lesson predict prompt remains authoritative and is copied into
 * the legacy model mirror.
 */
export function replaceVoxelAuthoringModel(
  draftValue: unknown,
  modelValue: unknown,
): VoxelAuthoringDraft {
  const draft = parseVoxelAuthoringDraft(draftValue);
  const model = parseVoxelSceneAdapterInput(modelValue);
  return parseVoxelAuthoringDraft({
    ...draft,
    model: {
      ...model,
      teacherPrompt: draft.model.teacherPrompt,
    },
  });
}

/** Atomically replaces the lesson and synchronizes its predict prompt mirror. */
export function replaceVoxelAuthoringLesson(
  draftValue: unknown,
  lessonValue: unknown,
): VoxelAuthoringDraft {
  const draft = parseVoxelAuthoringDraft(draftValue);
  const lesson = parseVoxelLessonPlan(lessonValue);
  const predictStep = lesson.steps[0];
  return parseVoxelAuthoringDraft({
    ...draft,
    model:
      predictStep?.kind === "predict" && predictStep.teacherPrompt
        ? { ...draft.model, teacherPrompt: predictStep.teacherPrompt }
        : draft.model,
    lesson,
  });
}

export async function voxelAuthoringDraftHash(draftValue: unknown): Promise<string> {
  return canonicalSha256(parseVoxelAuthoringDraft(draftValue));
}

export async function buildVoxelAuthoringPage(
  draftValue: unknown,
): Promise<VoxelLessonPageBuildResult> {
  const draft = parseVoxelAuthoringDraft(draftValue);
  return buildVoxelLessonPage(draft.model, draft.lesson);
}

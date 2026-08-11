import {
  createInitialSpatialRuntimeState,
  type CompiledVoxelLessonStep,
  type SpatialPageDoc,
  type SpatialRuntimeState,
} from "../domain";
import {
  applySpatialClassroomCommandIntent,
  createTeacherSpatialClassroomHost,
} from "../runtime";

const PREVIEW_TEACHER = { kind: "teacher-controller" as const, actorId: "editor.preview.teacher" };

export function resolveVoxelLessonPreviewStepId(
  page: SpatialPageDoc,
  compiledSteps: readonly CompiledVoxelLessonStep[],
  selectedLessonStepId: string,
): string {
  const selected = compiledSteps.find((entry) => entry.lessonStepId === selectedLessonStepId);
  const candidate = selected?.sceneStepIds[0] ?? page.scene.sequence.initialStepId;
  if (candidate && page.scene.sequence.steps.some((step) => step.id === candidate)) return candidate;
  return page.scene.sequence.initialStepId ?? page.scene.sequence.steps[0]?.id ?? "";
}

export async function createVoxelLessonPreviewState(
  page: SpatialPageDoc,
  compiledSteps: readonly CompiledVoxelLessonStep[],
  selectedLessonStepId: string,
): Promise<SpatialRuntimeState> {
  const targetStepId = resolveVoxelLessonPreviewStepId(page, compiledSteps, selectedLessonStepId);
  const initial = createInitialSpatialRuntimeState(page);
  if (!targetStepId || targetStepId === page.scene.sequence.initialStepId) return initial;
  const host = await createTeacherSpatialClassroomHost(page, PREVIEW_TEACHER);
  return applySpatialClassroomCommandIntent(page, host, "editor.preview.step", {
    kind: "step.go",
    stepId: targetStepId,
  }).host.state;
}

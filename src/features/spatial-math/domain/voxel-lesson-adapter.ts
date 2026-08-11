import { canonicalSha256 } from "./canonical-json";
import { parseSpatialScene, type SpatialSceneAction } from "./scene-schema";
import {
  buildVoxelCountingScene,
  materializeVoxelCountingPage,
  type VoxelCountingPageBuildResult,
  type VoxelCountingSceneBuildResult,
} from "./voxel-scene-adapter";
import { parseVoxelSceneAdapterInput } from "./voxel-scene-adapter-schema";
import {
  parseVoxelLessonPlan,
  type VoxelLessonPlan,
  type VoxelLessonStep,
} from "./voxel-lesson-schema";

export interface CompiledVoxelLessonStep {
  readonly lessonStepId: string;
  readonly sceneStepIds: readonly string[];
}

export interface VoxelLessonSceneBuildResult extends VoxelCountingSceneBuildResult {
  readonly lessonPlan: VoxelLessonPlan;
  readonly compiledSteps: readonly CompiledVoxelLessonStep[];
}

export interface VoxelLessonPageBuildResult extends VoxelLessonSceneBuildResult {
  readonly page: VoxelCountingPageBuildResult["page"];
}

function allLayerActions(layerIds: readonly string[], visibleLayerId: string | null): SpatialSceneAction[] {
  return layerIds.map((layerId) => ({
    kind: "layer.set",
    layerId,
    visible: visibleLayerId === null || visibleLayerId === layerId,
  }));
}

function ordinalTitle(step: VoxelLessonStep, canonicalIndex: number) {
  return {
    zh: `${step.title.zh}第 ${canonicalIndex + 1} 层`,
    ...(step.title.en ? { en: `${step.title.en} ${canonicalIndex + 1}` } : {}),
  };
}

export async function buildVoxelLessonScene(
  inputValue: unknown,
  lessonValue: unknown,
): Promise<VoxelLessonSceneBuildResult> {
  const input = parseVoxelSceneAdapterInput(inputValue);
  const built = await buildVoxelCountingScene(input);
  const lessonPlan = parseVoxelLessonPlan(lessonValue);
  const layerIds = built.scene.presentation.layers.map((layer) => layer.id);
  const compiledSteps: CompiledVoxelLessonStep[] = [];
  const steps = lessonPlan.steps.flatMap((step) => {
    if (step.kind === "layer-scan") {
      const playbackLayerIds = step.order === "descending" ? [...layerIds].reverse() : layerIds;
      const sceneSteps = playbackLayerIds.map((layerId, index) => ({
        id: `step.layer.${String(index + 1).padStart(3, "0")}`,
        title: ordinalTitle(step, layerIds.indexOf(layerId)),
        ...(step.teacherPrompt ? { teacherPrompt: step.teacherPrompt } : {}),
        transition: "none" as const,
        durationMs: 500,
        actions: [
          { kind: "camera.apply" as const, cameraId: "camera.perspective" },
          ...allLayerActions(layerIds, layerId),
        ],
      }));
      compiledSteps.push({ lessonStepId: step.id, sceneStepIds: sceneSteps.map((item) => item.id) });
      return sceneSteps;
    }

    const cameraId = step.kind === "view" ? `camera.${step.camera}` : "camera.perspective";
    const sceneStep = {
      id: step.id,
      title: step.title,
      ...(step.teacherPrompt ? { teacherPrompt: step.teacherPrompt } : {}),
      transition: step.kind === "predict" ? ("none" as const) : ("ease-in-out" as const),
      durationMs: step.kind === "predict" ? 0 : step.kind === "verify" ? 650 : 600,
      actions: [
        { kind: "camera.apply" as const, cameraId },
        ...allLayerActions(layerIds, null),
      ],
    };
    compiledSteps.push({ lessonStepId: step.id, sceneStepIds: [sceneStep.id] });
    return [sceneStep];
  });
  const checkpoints = [
    {
      id: "checkpoint.total-count",
      type: "numeric" as const,
      prompt: lessonPlan.checkpoint.prompt,
      revealPolicy: "after-submit" as const,
      responseFormat: "integer" as const,
      evaluator: {
        kind: "derived" as const,
        query: { kind: "voxel.total" as const, entityId: input.entityId },
      },
    },
  ];
  const scene = parseSpatialScene({
    ...built.scene,
    learning: {
      ...built.scene.learning,
      teacherPrompts: lessonPlan.steps.flatMap((step) =>
        step.teacherPrompt ? [step.teacherPrompt] : [],
      ),
    },
    sequence: { initialStepId: "step.predict", steps },
    checkpoints,
  });

  return {
    ...built,
    scene,
    sceneHash: await canonicalSha256(scene),
    lessonPlan,
    compiledSteps,
  };
}

export async function buildVoxelLessonPage(
  inputValue: unknown,
  lessonValue: unknown,
): Promise<VoxelLessonPageBuildResult> {
  const built = await buildVoxelLessonScene(inputValue, lessonValue);
  return {
    ...built,
    page: await materializeVoxelCountingPage(built.scene, {
      checkpointRequired: built.lessonPlan.checkpoint.required,
      maxSubmissions: built.lessonPlan.checkpoint.maxSubmissions,
    }),
  };
}

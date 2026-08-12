import { canonicalJsonStringify, canonicalSha256 } from "./canonical-json";
import { buildVoxelAuthoringPage } from "./voxel-authoring-draft";
import {
  parseVoxelAuthoringDraft,
  type VoxelAuthoringDraft,
} from "./voxel-authoring-draft-schema";
import {
  parseVoxelAuthoringDiff,
  VOXEL_AUTHORING_DIFF_VERSION,
  type VoxelAuthoringDiff,
} from "./voxel-authoring-diff-schema";
import type { VoxelLessonPageBuildResult } from "./voxel-lesson-adapter";
import type { VoxelLessonStep } from "./voxel-lesson-schema";
import { compareVoxelCoordinates, voxelKey } from "./voxel-schema";

export interface VoxelAuthoringDiffBuildResult {
  readonly diff: VoxelAuthoringDiff;
  readonly diffHash: string;
  /** Reusable 4:3 previews; deliberately excluded from the diff document and its hash. */
  readonly beforePreview: VoxelAuthoringDiffPreview;
  readonly afterPreview: VoxelAuthoringDiffPreview;
}

export interface VoxelAuthoringDiffPreview {
  readonly entityId: string;
  readonly build: VoxelLessonPageBuildResult;
}

function canonicalEquals(left: unknown, right: unknown): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function setDifference(after: readonly string[], before: readonly string[]): string[] {
  const beforeValues = new Set(before);
  return after.filter((value) => !beforeValues.has(value)).sort(compareStableStrings);
}

function cellDifference(
  after: VoxelAuthoringDraft["model"]["cells"],
  before: VoxelAuthoringDraft["model"]["cells"],
) {
  const beforeKeys = new Set(before.map(voxelKey));
  return after
    .filter((cell) => !beforeKeys.has(voxelKey(cell)))
    .sort(compareVoxelCoordinates);
}

function changedValue<T>(before: T, after: T): { before: T; after: T } | undefined {
  return canonicalEquals(before, after) ? undefined : { before, after };
}

function modelDiff(before: VoxelAuthoringDraft, after: VoxelAuthoringDraft) {
  const scalarChanges: unknown[] = [];
  for (const field of [
    "sceneId",
    "entityId",
    "layerAxis",
    "materialToken",
    "createdBy",
    "createdAt",
  ] as const) {
    if (before.model[field] !== after.model[field]) {
      scalarChanges.push({ field, before: before.model[field], after: after.model[field] });
    }
  }

  const localizedChanges: unknown[] = [];
  for (const field of ["title", "learningGoal", "misconception"] as const) {
    if (!canonicalEquals(before.model[field], after.model[field])) {
      localizedChanges.push({ field, before: before.model[field], after: after.model[field] });
    }
  }

  return {
    cellsAdded: cellDifference(after.model.cells, before.model.cells),
    cellsRemoved: cellDifference(before.model.cells, after.model.cells),
    scalarChanges,
    localizedChanges,
    termIds: {
      added: setDifference(after.model.termIds, before.model.termIds),
      removed: setDifference(before.model.termIds, after.model.termIds),
    },
    prerequisiteTermIds: {
      added: setDifference(after.model.prerequisiteTermIds, before.model.prerequisiteTermIds),
      removed: setDifference(before.model.prerequisiteTermIds, after.model.prerequisiteTermIds),
    },
  };
}

function nullablePrompt(step: VoxelLessonStep) {
  return step.teacherPrompt ?? null;
}

function lessonStepChange(before: VoxelLessonStep, after: VoxelLessonStep) {
  if (before.kind !== after.kind) {
    throw new TypeError(`lesson step kind changed without changing id: ${before.id}`);
  }

  const title = changedValue(before.title, after.title);
  const teacherPrompt = changedValue(nullablePrompt(before), nullablePrompt(after));
  const common = {
    stepId: before.id,
    kind: before.kind,
    ...(title ? { title } : {}),
    ...(teacherPrompt ? { teacherPrompt } : {}),
  };

  if (before.kind === "view" && after.kind === "view") {
    const camera = changedValue(before.camera, after.camera);
    return camera || title || teacherPrompt ? { ...common, ...(camera ? { camera } : {}) } : undefined;
  }
  if (before.kind === "layer-scan" && after.kind === "layer-scan") {
    const order = changedValue(before.order, after.order);
    return order || title || teacherPrompt ? { ...common, ...(order ? { order } : {}) } : undefined;
  }
  return title || teacherPrompt ? common : undefined;
}

function lessonDiff(before: VoxelAuthoringDraft, after: VoxelAuthoringDraft) {
  const beforeById = new Map(before.lesson.steps.map((step, index) => [step.id, { index, step }]));
  const afterById = new Map(after.lesson.steps.map((step, index) => [step.id, { index, step }]));
  const stepsAdded = after.lesson.steps
    .map((step, index) => ({ index, step }))
    .filter(({ step }) => !beforeById.has(step.id))
    .sort((left, right) => compareStableStrings(left.step.id, right.step.id));
  const stepsRemoved = before.lesson.steps
    .map((step, index) => ({ index, step }))
    .filter(({ step }) => !afterById.has(step.id))
    .sort((left, right) => compareStableStrings(left.step.id, right.step.id));
  const beforeCommonIndex = new Map(
    before.lesson.steps
      .filter((step) => afterById.has(step.id))
      .map((step, index) => [step.id, index]),
  );
  const afterCommonIndex = new Map(
    after.lesson.steps
      .filter((step) => beforeById.has(step.id))
      .map((step, index) => [step.id, index]),
  );
  const stepsMoved: {
    stepId: string;
    beforeIndex: number;
    afterIndex: number;
    beforeCommonIndex: number;
    afterCommonIndex: number;
  }[] = [];
  const stepsChanged: unknown[] = [];

  for (const [stepId, beforeEntry] of beforeById) {
    const afterEntry = afterById.get(stepId);
    if (!afterEntry) continue;
    const beforeRelativeIndex = beforeCommonIndex.get(stepId);
    const afterRelativeIndex = afterCommonIndex.get(stepId);
    if (beforeRelativeIndex === undefined || afterRelativeIndex === undefined) {
      throw new TypeError(`common lesson step has no relative index: ${stepId}`);
    }
    if (beforeRelativeIndex !== afterRelativeIndex) {
      stepsMoved.push({
        stepId,
        beforeIndex: beforeEntry.index,
        afterIndex: afterEntry.index,
        beforeCommonIndex: beforeRelativeIndex,
        afterCommonIndex: afterRelativeIndex,
      });
    }
    const change = lessonStepChange(beforeEntry.step, afterEntry.step);
    if (change) stepsChanged.push(change);
  }
  stepsMoved.sort((left, right) => compareStableStrings(left.stepId, right.stepId));
  stepsChanged.sort((left, right) =>
    compareStableStrings(
      (left as { stepId: string }).stepId,
      (right as { stepId: string }).stepId,
    ),
  );

  const prompt = changedValue(before.lesson.checkpoint.prompt, after.lesson.checkpoint.prompt);
  const required = changedValue(before.lesson.checkpoint.required, after.lesson.checkpoint.required);
  const maxSubmissions = changedValue(
    before.lesson.checkpoint.maxSubmissions,
    after.lesson.checkpoint.maxSubmissions,
  );

  return {
    stepsAdded,
    stepsRemoved,
    stepsMoved,
    stepsChanged,
    checkpoint: {
      ...(prompt ? { prompt } : {}),
      ...(required ? { required } : {}),
      ...(maxSubmissions ? { maxSubmissions } : {}),
    },
  };
}

function layerStepSnapshots(build: VoxelLessonPageBuildResult) {
  const compiledLayerStep = build.compiledSteps.find(
    (step) => step.lessonStepId === "step.layers",
  );
  if (!compiledLayerStep) throw new TypeError("compiled lesson is missing step.layers");

  const sceneSteps = new Map(build.scene.sequence.steps.map((step) => [step.id, step]));
  const layers = new Map(build.scene.presentation.layers.map((layer, index) => [layer.id, { layer, index }]));

  return compiledLayerStep.sceneStepIds.map((sceneStepId, playbackIndex) => {
    const sceneStep = sceneSteps.get(sceneStepId);
    if (!sceneStep) throw new TypeError(`compiled layer step does not exist: ${sceneStepId}`);
    const visibleLayerActions = sceneStep.actions.filter(
      (action) => action.kind === "layer.set" && action.visible,
    );
    if (visibleLayerActions.length !== 1) {
      throw new TypeError(`compiled layer step must reveal exactly one layer: ${sceneStepId}`);
    }
    const visibleLayerAction = visibleLayerActions[0];
    if (visibleLayerAction.kind !== "layer.set") {
      throw new TypeError(`compiled layer step has an invalid layer action: ${sceneStepId}`);
    }
    const layerEntry = layers.get(visibleLayerAction.layerId);
    if (!layerEntry || layerEntry.layer.selector.kind !== "voxel-axis-range") {
      throw new TypeError(`compiled layer step references an invalid voxel layer: ${sceneStepId}`);
    }
    if (layerEntry.layer.selector.min !== layerEntry.layer.selector.max) {
      throw new TypeError(`compiled lesson layer must select one coordinate: ${visibleLayerAction.layerId}`);
    }
    return {
      playbackIndex,
      sceneStepId,
      layerId: visibleLayerAction.layerId,
      axis: layerEntry.layer.selector.axis,
      coordinate: layerEntry.layer.selector.min,
      canonicalOrdinal: layerEntry.index + 1,
      title: sceneStep.title,
      ...(sceneStep.teacherPrompt ? { teacherPrompt: sceneStep.teacherPrompt } : {}),
    };
  });
}

async function voxelMathSnapshot(
  draft: VoxelAuthoringDraft,
  build: VoxelLessonPageBuildResult,
) {
  const projections = await Promise.all(
    build.projections.map(async (projection) => {
      if (
        projection.view !== "front" &&
        projection.view !== "right" &&
        projection.view !== "top"
      ) {
        throw new TypeError(`unexpected primary projection: ${projection.view}`);
      }
      if (!projection.bounds) {
        throw new TypeError(`non-empty voxel model has empty ${projection.view} bounds`);
      }
      return {
        view: projection.view,
        visibleVoxelCount: projection.visibleVoxelCount,
        hiddenVoxelCount: projection.hiddenVoxelCount,
        shapeFingerprint: await canonicalSha256(
          projection.cells.map((cell) => ({
            u: cell.u,
            v: cell.v,
            stackSize: cell.stackSize,
          })),
        ),
        bounds: projection.bounds,
      };
    }),
  );
  const byView = new Map(projections.map((projection) => [projection.view, projection]));
  const front = byView.get("front");
  const right = byView.get("right");
  const top = byView.get("top");
  if (!front || !right || !top) {
    throw new TypeError("compiled voxel lesson is missing a primary projection");
  }

  return {
    totalCount: build.totalCount,
    layerAxis: draft.model.layerAxis,
    layerCounts: build.layerCounts,
    projections: [front, right, top] as const,
  };
}

export async function voxelAuthoringDiffHash(diffValue: unknown): Promise<string> {
  return canonicalSha256(parseVoxelAuthoringDiff(diffValue));
}

export async function buildVoxelAuthoringDiff(
  beforeValue: unknown,
  afterValue: unknown,
): Promise<VoxelAuthoringDiffBuildResult> {
  const beforeDraft = parseVoxelAuthoringDraft(beforeValue);
  const afterDraft = parseVoxelAuthoringDraft(afterValue);
  const [beforeBuild, afterBuild, beforeDraftHash, afterDraftHash] = await Promise.all([
    buildVoxelAuthoringPage(beforeDraft),
    buildVoxelAuthoringPage(afterDraft),
    canonicalSha256(beforeDraft),
    canonicalSha256(afterDraft),
  ]);
  const [beforePageHash, afterPageHash, beforeVoxelMath, afterVoxelMath] = await Promise.all([
    canonicalSha256(beforeBuild.page),
    canonicalSha256(afterBuild.page),
    voxelMathSnapshot(beforeDraft, beforeBuild),
    voxelMathSnapshot(afterDraft, afterBuild),
  ]);
  const beforeLayerSteps = layerStepSnapshots(beforeBuild);
  const afterLayerSteps = layerStepSnapshots(afterBuild);
  const layerStepsChanged = !canonicalEquals(beforeLayerSteps, afterLayerSteps);
  const voxelMathChanged = !canonicalEquals(beforeVoxelMath, afterVoxelMath);
  const voxelMathRequired =
    !canonicalEquals(beforeDraft.model.cells, afterDraft.model.cells) ||
    beforeDraft.model.layerAxis !== afterDraft.model.layerAxis;
  const beforeLayerScan = beforeDraft.lesson.steps.find((step) => step.kind === "layer-scan");
  const afterLayerScan = afterDraft.lesson.steps.find((step) => step.kind === "layer-scan");
  if (!beforeLayerScan || !afterLayerScan) {
    throw new TypeError("voxel lesson is missing step.layers");
  }
  const layerStepsRequired =
    voxelMathRequired || !canonicalEquals(beforeLayerScan, afterLayerScan);

  const diff = parseVoxelAuthoringDiff({
    diffVersion: VOXEL_AUTHORING_DIFF_VERSION,
    draftVersion: beforeDraft.draftVersion,
    before: {
      draftHash: beforeDraftHash,
      sceneHash: beforeBuild.sceneHash,
      pageHash: beforePageHash,
    },
    after: {
      draftHash: afterDraftHash,
      sceneHash: afterBuild.sceneHash,
      pageHash: afterPageHash,
    },
    authored: {
      model: modelDiff(beforeDraft, afterDraft),
      lesson: lessonDiff(beforeDraft, afterDraft),
    },
    derived: {
      ...(voxelMathRequired
        ? {
            voxelMath: {
              changed: voxelMathChanged,
              before: beforeVoxelMath,
              after: afterVoxelMath,
            },
          }
        : {}),
      ...(layerStepsRequired
        ? {
            layerSteps: {
              changed: layerStepsChanged,
              before: beforeLayerSteps,
              after: afterLayerSteps,
            },
          }
        : {}),
    },
  });

  return {
    diff,
    diffHash: await canonicalSha256(diff),
    beforePreview: { entityId: beforeDraft.model.entityId, build: beforeBuild },
    afterPreview: { entityId: afterDraft.model.entityId, build: afterBuild },
  };
}

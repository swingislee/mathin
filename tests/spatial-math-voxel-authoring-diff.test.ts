import { describe, expect, it } from "vitest";
import { canonicalJsonStringify } from "@/features/spatial-math/domain/canonical-json";
import {
  buildVoxelAuthoringDiff,
  voxelAuthoringDiffHash,
} from "@/features/spatial-math/domain/voxel-authoring-diff";
import {
  parseVoxelAuthoringDiff,
  VOXEL_AUTHORING_DIFF_LIMITS,
  VOXEL_AUTHORING_DIFF_VERSION,
} from "@/features/spatial-math/domain/voxel-authoring-diff-schema";
import {
  buildVoxelAuthoringPage,
  createDefaultVoxelAuthoringDraft,
  replaceVoxelAuthoringLesson,
  replaceVoxelAuthoringModel,
} from "@/features/spatial-math/domain/voxel-authoring-draft";
import type { VoxelAuthoringDraft } from "@/features/spatial-math/domain/voxel-authoring-draft-schema";
import { buildVoxelLessonScene } from "@/features/spatial-math/domain/voxel-lesson-adapter";
import { createDefaultVoxelLessonPlan } from "@/features/spatial-math/domain/voxel-lesson-schema";
import { buildVoxelCountingScene } from "@/features/spatial-math/domain/voxel-scene-adapter";
import { voxelCountingAdapterInput } from "./fixtures/spatial-voxel-scene";

function baseDraft(): VoxelAuthoringDraft {
  return createDefaultVoxelAuthoringDraft(voxelCountingAdapterInput());
}

function oneCellPerLayerDraft(layerCount: number): VoxelAuthoringDraft {
  const input = voxelCountingAdapterInput();
  return createDefaultVoxelAuthoringDraft({
    ...input,
    sceneId: `scene.voxel-counting.diff-layers-${layerCount}`,
    cells: Array.from({ length: layerCount }, (_, y) => ({ x: 0, y, z: 0 })),
  });
}

describe("voxel-authoring-diff-v1", () => {
  it("builds a deterministic strict no-op diff and reusable standard 4:3 previews", async () => {
    const before = baseDraft();
    const reordered = {
      lesson: before.lesson,
      draftVersion: before.draftVersion,
      model: before.model,
    };
    const first = await buildVoxelAuthoringDiff(before, reordered);
    const second = await buildVoxelAuthoringDiff(reordered, before);

    expect(first.diff).toEqual(second.diff);
    expect(first.diffHash).toBe(second.diffHash);
    expect(first.diffHash).toBe(await voxelAuthoringDiffHash(first.diff));
    expect(first.diff).toMatchObject({
      diffVersion: VOXEL_AUTHORING_DIFF_VERSION,
      draftVersion: "voxel-authoring-draft-v1",
      authored: {
        model: {
          cellsAdded: [],
          cellsRemoved: [],
          scalarChanges: [],
          localizedChanges: [],
          termIds: { added: [], removed: [] },
          prerequisiteTermIds: { added: [], removed: [] },
        },
        lesson: {
          stepsAdded: [],
          stepsRemoved: [],
          stepsMoved: [],
          stepsChanged: [],
          checkpoint: {},
        },
      },
      derived: {},
    });
    expect(first.diff.before).toEqual(first.diff.after);
    for (const { build: built } of [first.beforePreview, first.afterPreview]) {
      expect(built.page.layout).toEqual({ profile: "standard-4x3" });
      expect(built.page.presentation.viewport).toMatchObject({ width: 1_200, height: 900 });
    }
    const documentJson = canonicalJsonStringify(first.diff);
    expect(documentJson).not.toContain('"page":');
    expect(documentJson).not.toContain('"runtime":');
    expect(documentJson).not.toContain('"actions":');
  });

  it("reports cell changes, authoritative voxel math and a reversible hash envelope", async () => {
    const before = baseDraft();
    const after = replaceVoxelAuthoringModel(before, {
      ...before.model,
      cells: [...before.model.cells, { x: 3, y: 0, z: 0 }],
    });
    const forward = await buildVoxelAuthoringDiff(before, after);
    const reverse = await buildVoxelAuthoringDiff(after, before);

    expect(forward.diff.authored.model.cellsAdded).toEqual([{ x: 3, y: 0, z: 0 }]);
    expect(forward.diff.authored.model.cellsRemoved).toEqual([]);
    expect(forward.diff.derived.layerSteps).toMatchObject({ changed: false });
    expect(forward.diff.derived.voxelMath).toMatchObject({
      changed: true,
      before: { totalCount: 10, layerAxis: "y" },
      after: { totalCount: 11, layerAxis: "y" },
    });
    const math = forward.diff.derived.voxelMath!;
    expect(math.before.layerCounts.map((layer) => layer.count)).toEqual([6, 3, 1]);
    expect(math.after.layerCounts.map((layer) => layer.count)).toEqual([7, 3, 1]);
    expect(math.after.projections.map((projection) => projection.view)).toEqual([
      "front",
      "right",
      "top",
    ]);
    for (const projection of math.after.projections) {
      expect(projection.visibleVoxelCount + projection.hiddenVoxelCount).toBe(11);
      expect(projection.shapeFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(projection.bounds.minU).toBeLessThanOrEqual(projection.bounds.maxU);
      expect(projection.bounds.minV).toBeLessThanOrEqual(projection.bounds.maxV);
    }

    const missingMath = structuredClone(forward.diff);
    delete missingMath.derived.voxelMath;
    expect(() => parseVoxelAuthoringDiff(missingMath)).toThrow(
      /cell or layerAxis changes require derived voxel-math snapshots/,
    );

    const missingLayerSteps = structuredClone(forward.diff);
    delete missingLayerSteps.derived.layerSteps;
    expect(() => parseVoxelAuthoringDiff(missingLayerSteps)).toThrow(
      /model or layer-scan changes require derived layer-step snapshots/,
    );

    expect(reverse.diff.authored.model.cellsRemoved).toEqual([{ x: 3, y: 0, z: 0 }]);
    expect(reverse.diff.authored.model.cellsAdded).toEqual([]);
    expect(reverse.diff.before).toEqual(forward.diff.after);
    expect(reverse.diff.after).toEqual(forward.diff.before);
    expect(reverse.diff.derived.voxelMath?.before).toEqual(math.after);
    expect(reverse.diff.derived.voxelMath?.after).toEqual(math.before);
  });

  it("separates authored cells from changed derived layer-step expansion", async () => {
    const before = baseDraft();
    const after = replaceVoxelAuthoringModel(before, {
      ...before.model,
      cells: before.model.cells.filter((cell) => !(cell.x === 0 && cell.y === 2 && cell.z === 0)),
    });
    const result = await buildVoxelAuthoringDiff(before, after);

    expect(result.diff.authored.model.cellsRemoved).toEqual([{ x: 0, y: 2, z: 0 }]);
    expect(result.diff.authored.lesson).toMatchObject({
      stepsAdded: [],
      stepsRemoved: [],
      stepsMoved: [],
      stepsChanged: [],
      checkpoint: {},
    });
    expect(result.diff.derived.voxelMath).toMatchObject({
      changed: true,
      before: { totalCount: 10, layerCounts: [{ coordinate: 0 }, { coordinate: 1 }, { coordinate: 2 }] },
      after: { totalCount: 9, layerCounts: [{ coordinate: 0 }, { coordinate: 1 }] },
    });
    expect(result.diff.derived.layerSteps?.changed).toBe(true);
    expect(result.diff.derived.layerSteps?.before.map((step) => step.canonicalOrdinal)).toEqual([1, 2, 3]);
    expect(result.diff.derived.layerSteps?.after.map((step) => step.canonicalOrdinal)).toEqual([1, 2]);
  });

  it("covers every authored model field without duplicating the predict prompt mirror", async () => {
    const before = baseDraft();
    const after = replaceVoxelAuthoringModel(before, {
      ...before.model,
      sceneId: "scene.voxel-counting.changed",
      entityId: "voxel.changed",
      layerAxis: "z",
      materialToken: "voxel.highlight",
      createdBy: "00000000-0000-4000-8000-000000000002",
      createdAt: "2026-08-13T00:00:00+08:00",
      title: { zh: "新标题", en: "New title" },
      learningGoal: { zh: "新目标", en: "New goal" },
      misconception: { zh: "新误区", en: "New misconception" },
      termIds: ["solid-figures", "voxel-counting"],
      prerequisiteTermIds: ["counting", "solid-figures"],
    });
    const result = await buildVoxelAuthoringDiff(before, after);

    expect(result.diff.authored.model.scalarChanges.map((change) => change.field)).toEqual([
      "sceneId",
      "entityId",
      "layerAxis",
      "materialToken",
      "createdBy",
      "createdAt",
    ]);
    expect(result.diff.authored.model.localizedChanges.map((change) => change.field)).toEqual([
      "title",
      "learningGoal",
      "misconception",
    ]);
    expect(result.diff.authored.model.termIds).toEqual({
      added: ["voxel-counting"],
      removed: ["views-of-objects"],
    });
    expect(result.diff.authored.model.prerequisiteTermIds).toEqual({
      added: ["counting"],
      removed: [],
    });
    expect(result.diff.authored.lesson.stepsChanged).toEqual([]);
    expect(result.diff.derived.voxelMath).toMatchObject({
      changed: true,
      before: { layerAxis: "y", totalCount: 10 },
      after: { layerAxis: "z", totalCount: 10 },
    });
    expect(result.diff.derived.layerSteps?.before[0].axis).toBe("y");
    expect(result.diff.derived.layerSteps?.after[0].axis).toBe("z");
    expect(Object.hasOwn(result.diff.authored.model, "teacherPrompt")).toBe(false);
    expect(canonicalJsonStringify(result.diff.authored.model)).not.toContain("teacherPrompt");
    expect(result.beforePreview.entityId).toBe(before.model.entityId);
    expect(result.afterPreview.entityId).toBe(after.model.entityId);
    expect(result.beforePreview.build.scene.model.entities[0]?.id).toBe(
      result.beforePreview.entityId,
    );
    expect(result.afterPreview.build.scene.model.entities[0]?.id).toBe(
      result.afterPreview.entityId,
    );
  });

  it("does not misreport downstream moves when a view is removed", async () => {
    const before = baseDraft();
    const after = replaceVoxelAuthoringLesson(before, {
      ...before.lesson,
      steps: before.lesson.steps.filter((step) => step.id !== "step.front"),
    });
    const result = await buildVoxelAuthoringDiff(before, after);

    expect(result.diff.authored.lesson.stepsRemoved).toEqual([
      { index: 1, step: before.lesson.steps[1] },
    ]);
    expect(result.diff.authored.lesson.stepsAdded).toEqual([]);
    expect(result.diff.authored.lesson.stepsMoved).toEqual([]);
    expect(result.diff.derived).toEqual({});
  });

  it("keeps original indexes while detecting reorders by common-step rank", async () => {
    const before = baseDraft();
    const predict = before.lesson.steps.find((step) => step.id === "step.predict")!;
    const front = before.lesson.steps.find((step) => step.id === "step.front")!;
    const right = before.lesson.steps.find((step) => step.id === "step.right")!;
    const layers = before.lesson.steps.find((step) => step.id === "step.layers")!;
    const verify = before.lesson.steps.find((step) => step.id === "step.verify")!;
    const replacementTop = {
      id: "step.top.new",
      kind: "view" as const,
      camera: "top" as const,
      title: { zh: "新的上面", en: "New top view" },
    };
    const after = replaceVoxelAuthoringLesson(before, {
      ...before.lesson,
      steps: [predict, replacementTop, right, front, layers, verify],
    });
    const result = await buildVoxelAuthoringDiff(before, after);

    expect(result.diff.authored.lesson.stepsAdded).toEqual([{ index: 1, step: replacementTop }]);
    expect(result.diff.authored.lesson.stepsRemoved).toEqual([
      { index: 3, step: before.lesson.steps[3] },
    ]);
    expect(result.diff.authored.lesson.stepsMoved).toEqual([
      {
        stepId: "step.front",
        beforeIndex: 1,
        afterIndex: 3,
        beforeCommonIndex: 1,
        afterCommonIndex: 2,
      },
      {
        stepId: "step.right",
        beforeIndex: 2,
        afterIndex: 2,
        beforeCommonIndex: 2,
        afterCommonIndex: 1,
      },
    ]);
    expect(result.diff.authored.lesson.stepsChanged).toEqual([]);
  });

  it("reports true common-step swaps and bilingual lesson changes in stable id order", async () => {
    const before = baseDraft();
    const predict = before.lesson.steps.find((step) => step.id === "step.predict")!;
    const front = before.lesson.steps.find((step) => step.id === "step.front")!;
    const right = before.lesson.steps.find((step) => step.id === "step.right")!;
    const top = before.lesson.steps.find((step) => step.id === "step.top")!;
    const layers = before.lesson.steps.find((step) => step.id === "step.layers")!;
    const verify = before.lesson.steps.find((step) => step.id === "step.verify")!;
    if (verify.kind !== "verify") throw new TypeError("fixture requires step.verify");
    const verifyWithoutPrompt = { id: verify.id, kind: verify.kind, title: verify.title };
    const prompt = { zh: "从右面先预测隐藏方块。", en: "Predict hidden cubes from the right." };
    const after = replaceVoxelAuthoringLesson(before, {
      ...before.lesson,
      steps: [
        { ...predict, teacherPrompt: prompt },
        front,
        { ...top, title: { zh: "只看上面" } },
        right,
        {
          ...layers,
          title: { zh: "逐层核对", en: "Check layer" },
          teacherPrompt: { zh: "按倒序逐层核对。", en: "Check each layer in reverse." },
          order: "descending",
        },
        verifyWithoutPrompt,
      ],
    });
    const result = await buildVoxelAuthoringDiff(before, after);

    expect(result.diff.authored.lesson.stepsMoved).toEqual([
      {
        stepId: "step.right",
        beforeIndex: 2,
        afterIndex: 3,
        beforeCommonIndex: 2,
        afterCommonIndex: 3,
      },
      {
        stepId: "step.top",
        beforeIndex: 3,
        afterIndex: 2,
        beforeCommonIndex: 3,
        afterCommonIndex: 2,
      },
    ]);
    expect(result.diff.authored.lesson.stepsChanged.map((change) => change.stepId)).toEqual([
      "step.layers",
      "step.predict",
      "step.top",
      "step.verify",
    ]);
    expect(result.diff.authored.lesson.stepsChanged.find((change) => change.stepId === "step.layers")).toMatchObject({
      kind: "layer-scan",
      order: { before: "ascending", after: "descending" },
      title: { after: { zh: "逐层核对", en: "Check layer" } },
    });
    expect(result.diff.authored.lesson.stepsChanged.find((change) => change.stepId === "step.top")).toMatchObject({
      title: { before: { en: "Top view" }, after: { zh: "只看上面" } },
    });
    expect(result.diff.authored.lesson.stepsChanged.find((change) => change.stepId === "step.verify")).toMatchObject({
      teacherPrompt: { after: null },
    });
    expect(result.diff.derived.voxelMath).toBeUndefined();
    expect(result.diff.derived.layerSteps?.changed).toBe(true);
    expect(result.diff.derived.layerSteps?.before.map((step) => step.coordinate)).toEqual([0, 1, 2]);
    expect(result.diff.derived.layerSteps?.after.map((step) => step.coordinate)).toEqual([2, 1, 0]);
    expect(result.diff.derived.layerSteps?.after.map((step) => step.canonicalOrdinal)).toEqual([3, 2, 1]);
    expect(after.model.teacherPrompt).toEqual(prompt);
    expect(Object.hasOwn(result.diff.authored.model, "teacherPrompt")).toBe(false);

    const forgedLayerIdentity = structuredClone(result.diff);
    for (const step of forgedLayerIdentity.derived.layerSteps!.after) {
      step.axis = "z";
      step.layerId = step.layerId.replace("layer.y.", "layer.z.");
    }
    expect(() => parseVoxelAuthoringDiff(forgedLayerIdentity)).toThrow(
      /lesson-only layer changes must preserve compiled layer identity/,
    );

    const singleLayerBefore = oneCellPerLayerDraft(1);
    const singleLayerScan = singleLayerBefore.lesson.steps.find(
      (step) => step.kind === "layer-scan",
    );
    if (!singleLayerScan) throw new TypeError("fixture requires a layer-scan step");
    const singleLayerAfter = replaceVoxelAuthoringLesson(singleLayerBefore, {
      ...singleLayerBefore.lesson,
      steps: singleLayerBefore.lesson.steps.map((step) =>
        step.id === singleLayerScan.id ? { ...step, order: "descending" as const } : step,
      ),
    });
    const singleLayerDiff = await buildVoxelAuthoringDiff(singleLayerBefore, singleLayerAfter);
    expect(singleLayerDiff.diff.authored.lesson.stepsChanged).toMatchObject([
      { stepId: "step.layers", kind: "layer-scan", order: { before: "ascending", after: "descending" } },
    ]);
    expect(singleLayerDiff.diff.derived.layerSteps).toMatchObject({ changed: false });
    expect(singleLayerDiff.diff.derived.layerSteps?.before).toEqual(
      singleLayerDiff.diff.derived.layerSteps?.after,
    );
    expect(singleLayerDiff.diff.before.sceneHash).toBe(singleLayerDiff.diff.after.sceneHash);
    expect(singleLayerDiff.diff.before.pageHash).toBe(singleLayerDiff.diff.after.pageHash);
    const unexplainedCompiledHashes = structuredClone(singleLayerDiff.diff);
    unexplainedCompiledHashes.after.sceneHash = "f".repeat(64);
    unexplainedCompiledHashes.after.pageHash = "e".repeat(64);
    expect(() => parseVoxelAuthoringDiff(unexplainedCompiledHashes)).toThrow(
      /compiled scene hash must stay unchanged/,
    );
  });

  it("distinguishes page-only checkpoint policy from scene-authored checkpoint prompts", async () => {
    const before = baseDraft();
    const policyAfter = replaceVoxelAuthoringLesson(before, {
      ...before.lesson,
      checkpoint: { ...before.lesson.checkpoint, required: false, maxSubmissions: 5 },
    });
    const policy = await buildVoxelAuthoringDiff(before, policyAfter);

    expect(policy.diff.authored.lesson.checkpoint).toEqual({
      required: { before: true, after: false },
      maxSubmissions: { before: 3, after: 5 },
    });
    expect(policy.diff.before.sceneHash).toBe(policy.diff.after.sceneHash);
    expect(policy.diff.before.pageHash).not.toBe(policy.diff.after.pageHash);
    expect(policy.diff.derived).toEqual({});
    const missingPolicyPageHash = structuredClone(policy.diff);
    missingPolicyPageHash.after.pageHash = missingPolicyPageHash.before.pageHash;
    expect(() => parseVoxelAuthoringDiff(missingPolicyPageHash)).toThrow(
      /compiled page hash must change for authored page content/,
    );

    const promptAfter = replaceVoxelAuthoringLesson(policyAfter, {
      ...policyAfter.lesson,
      checkpoint: {
        ...policyAfter.lesson.checkpoint,
        prompt: { zh: "新的总数问题", en: "A revised total-count question" },
      },
    });
    const prompt = await buildVoxelAuthoringDiff(policyAfter, promptAfter);
    expect(prompt.diff.authored.lesson.checkpoint).toMatchObject({
      prompt: {
        before: before.lesson.checkpoint.prompt,
        after: { zh: "新的总数问题", en: "A revised total-count question" },
      },
    });
    expect(prompt.diff.before.sceneHash).not.toBe(prompt.diff.after.sceneHash);
    expect(prompt.diff.before.pageHash).not.toBe(prompt.diff.after.pageHash);
  });

  it("rejects unstable, incoherent and non-strict diff documents", async () => {
    const before = baseDraft();
    const after = replaceVoxelAuthoringModel(before, {
      ...before.model,
      cells: [
        ...before.model.cells,
        { x: 3, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
      ],
    });
    const valid = (await buildVoxelAuthoringDiff(before, after)).diff;

    expect(() => parseVoxelAuthoringDiff({ ...valid, runtime: {} })).toThrow();

    const unstableCells = structuredClone(valid);
    unstableCells.authored.model.cellsAdded.reverse();
    expect(() => parseVoxelAuthoringDiff(unstableCells)).toThrow(/stable coordinate order/);

    const unchangedDraftHash = structuredClone(valid);
    unchangedDraftHash.after.draftHash = unchangedDraftHash.before.draftHash;
    expect(() => parseVoxelAuthoringDiff(unchangedDraftHash)).toThrow(/draft hash change/);

    const incoherentMath = structuredClone(valid);
    incoherentMath.derived.voxelMath!.after.totalCount += 1;
    expect(() => parseVoxelAuthoringDiff(incoherentMath)).toThrow(/totalCount/);

    const incoherentMathFlag = structuredClone(valid);
    incoherentMathFlag.derived.voxelMath!.changed = false;
    expect(() => parseVoxelAuthoringDiff(incoherentMathFlag)).toThrow(
      /derived voxel-math changed flag is incoherent/,
    );

    const incoherentLayerFlag = structuredClone(valid);
    incoherentLayerFlag.derived.layerSteps!.changed = true;
    expect(() => parseVoxelAuthoringDiff(incoherentLayerFlag)).toThrow(
      /derived layer-step changed flag is incoherent/,
    );

    const titleOnlyAfter = replaceVoxelAuthoringModel(before, {
      ...before.model,
      title: { zh: "改过的标题", en: "Revised title" },
    });
    const missingSceneHash = structuredClone(
      (await buildVoxelAuthoringDiff(before, titleOnlyAfter)).diff,
    );
    missingSceneHash.after.sceneHash = missingSceneHash.before.sceneHash;
    missingSceneHash.after.pageHash = missingSceneHash.before.pageHash;
    expect(() => parseVoxelAuthoringDiff(missingSceneHash)).toThrow(
      /compiled scene hash must change for authored scene content/,
    );

    const incompleteLayerSteps = structuredClone(valid);
    incompleteLayerSteps.derived.layerSteps = {
      changed: false,
      before: [
        {
          playbackIndex: 0,
          sceneStepId: "step.layer.001",
          layerId: "layer.y.c1024",
          axis: "y",
          coordinate: 0,
          canonicalOrdinal: 1,
          title: { zh: "第一层" },
        },
      ],
      after: [
        {
          playbackIndex: 0,
          sceneStepId: "step.layer.001",
          layerId: "layer.y.c1024",
          axis: "y",
          coordinate: 0,
          canonicalOrdinal: 1,
          title: { zh: "第一层" },
        },
      ],
    };
    expect(() => parseVoxelAuthoringDiff(incompleteLayerSteps)).toThrow(
      /must match the voxel-math layers/,
    );

    const layerScan = before.lesson.steps.find((step) => step.kind === "layer-scan");
    if (!layerScan) throw new TypeError("fixture requires a layer-scan step");
    const revisedLayerTitle = replaceVoxelAuthoringLesson(before, {
      ...before.lesson,
      steps: before.lesson.steps.map((step) =>
        step.id === layerScan.id ? { ...step, title: { zh: "逐层核对" } } : step,
      ),
    });
    const invalidLayerTitle = structuredClone(
      (await buildVoxelAuthoringDiff(before, revisedLayerTitle)).diff,
    );
    const layerTitleChange = invalidLayerTitle.authored.lesson.stepsChanged.find(
      (change) => change.kind === "layer-scan",
    );
    if (!layerTitleChange?.title) {
      throw new TypeError("diff fixture requires a changed layer-scan title");
    }
    layerTitleChange.title.after.zh = "层".repeat(1_991);
    expect(() => parseVoxelAuthoringDiff(invalidLayerTitle)).toThrow(/layer title is too long/);

    const movedAfter = replaceVoxelAuthoringLesson(before, {
      ...before.lesson,
      steps: [
        before.lesson.steps[0],
        before.lesson.steps[2],
        before.lesson.steps[1],
        ...before.lesson.steps.slice(3),
      ],
    });
    const duplicateMovedRank = structuredClone(
      (await buildVoxelAuthoringDiff(before, movedAfter)).diff,
    );
    duplicateMovedRank.authored.lesson.stepsMoved[1].beforeCommonIndex =
      duplicateMovedRank.authored.lesson.stepsMoved[0].beforeCommonIndex;
    expect(() => parseVoxelAuthoringDiff(duplicateMovedRank)).toThrow(
      /duplicate moved-step beforeCommonIndex/,
    );

    const removedLayerAfter = replaceVoxelAuthoringModel(before, {
      ...before.model,
      cells: before.model.cells.filter(
        (cell) => !(cell.x === 0 && cell.y === 2 && cell.z === 0),
      ),
    });
    const incoherentLayers = structuredClone(
      (await buildVoxelAuthoringDiff(before, removedLayerAfter)).diff,
    );
    incoherentLayers.derived.layerSteps!.after[0].axis = "z";
    expect(() => parseVoxelAuthoringDiff(incoherentLayers)).toThrow(
      /one axis|must match the voxel-math layers/,
    );
  });

  it("accepts the 85-layer compile boundary and preserves existing adapter hashes", async () => {
    const before = oneCellPerLayerDraft(85);
    const after = oneCellPerLayerDraft(84);
    const result = await buildVoxelAuthoringDiff(before, after);
    const input = voxelCountingAdapterInput();
    const [baseScene, lessonScene, page] = await Promise.all([
      buildVoxelCountingScene(input),
      buildVoxelLessonScene(input, createDefaultVoxelLessonPlan(input.teacherPrompt)),
      buildVoxelAuthoringPage(baseDraft()),
    ]);

    expect(result.diff.derived.voxelMath?.before.layerCounts).toHaveLength(85);
    expect(result.diff.derived.voxelMath?.after.layerCounts).toHaveLength(84);
    expect(result.diff.derived.layerSteps?.before).toHaveLength(85);
    expect(result.diff.derived.layerSteps?.after).toHaveLength(84);
    expect(result.beforePreview.build.page.layout).toEqual({ profile: "standard-4x3" });
    expect(result.afterPreview.build.page.presentation.viewport).toMatchObject({ width: 1_200, height: 900 });
    expect(baseScene.sceneHash).toBe("b860667157a075c7e8e75d929543e542cf3e6d7dbe9f375087d781903ea343a4");
    expect(lessonScene.sceneHash).toBe("dcf92339cecccfafab1e3255163850404bcf5cae74aea644c84bb31a503b4a75");
    expect(page.sceneHash).toBe(lessonScene.sceneHash);
  });

  it("enforces the canonical UTF-8 diff size gate at the schema boundary", async () => {
    const before = baseDraft();
    const after = replaceVoxelAuthoringModel(before, {
      ...before.model,
      cells: [...before.model.cells, { x: 3, y: 0, z: 0 }],
    });
    const oversized = structuredClone((await buildVoxelAuthoringDiff(before, after)).diff);
    const beforeText = { zh: "\uD800".repeat(2_000), en: "\uD800".repeat(2_000) };
    const afterText = { zh: "\uD801".repeat(2_000), en: "\uD801".repeat(2_000) };
    oversized.authored.model.localizedChanges = [
      { field: "title", before: beforeText, after: afterText },
      { field: "learningGoal", before: beforeText, after: afterText },
      { field: "misconception", before: beforeText, after: afterText },
    ];
    oversized.authored.lesson.stepsChanged = Array.from({ length: 12 }, (_, index) => ({
      stepId: `step.size-${String(index).padStart(2, "0")}`,
      kind: "predict" as const,
      title: { before: beforeText, after: afterText },
      teacherPrompt: { before: beforeText, after: afterText },
    }));
    oversized.authored.lesson.stepsAdded = Array.from({ length: 12 }, (_, index) => ({
      index,
      step: {
        id: `step.add-${String(index).padStart(2, "0")}`,
        kind: "predict" as const,
        title: afterText,
        teacherPrompt: afterText,
      },
    }));
    oversized.authored.lesson.stepsRemoved = Array.from({ length: 12 }, (_, index) => ({
      index,
      step: {
        id: `step.remove-${String(index).padStart(2, "0")}`,
        kind: "predict" as const,
        title: beforeText,
        teacherPrompt: beforeText,
      },
    }));
    oversized.authored.lesson.checkpoint = {
      prompt: { before: beforeText, after: afterText },
    };
    const addedCells = [] as { x: number; y: number; z: number }[];
    const removedCells = [] as { x: number; y: number; z: number }[];
    for (let x = -1_024; x < -1_008; x += 1) {
      for (let y = -1_024; y < -992; y += 1) {
        for (let z = -1_024; z < -1_008; z += 1) addedCells.push({ x, y, z });
      }
    }
    for (let x = -1_008; x < -992; x += 1) {
      for (let y = -1_024; y < -992; y += 1) {
        for (let z = -1_024; z < -1_008; z += 1) removedCells.push({ x, y, z });
      }
    }
    oversized.authored.model.cellsAdded = addedCells;
    oversized.authored.model.cellsRemoved = removedCells.slice(0, -1);
    const bytes = new TextEncoder().encode(canonicalJsonStringify(oversized)).byteLength;

    expect(VOXEL_AUTHORING_DIFF_LIMITS.maxBytes).toBe(
      2 * VOXEL_AUTHORING_DIFF_LIMITS.sourceDraftBytesPerSide +
        2 * VOXEL_AUTHORING_DIFF_LIMITS.sourceSceneBytesPerSide +
        VOXEL_AUTHORING_DIFF_LIMITS.structuralOverheadBytes,
    );
    expect(addedCells).toHaveLength(8_192);
    expect(removedCells).toHaveLength(8_192);
    expect(bytes).toBeGreaterThan(VOXEL_AUTHORING_DIFF_LIMITS.maxBytes);
    expect(() => parseVoxelAuthoringDiff(oversized)).toThrow(/authoring diff size/);
  });
});

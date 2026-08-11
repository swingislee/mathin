import { describe, expect, it } from "vitest";
import {
  VOXEL_AUTHORING_DRAFT_ISSUES,
  VOXEL_AUTHORING_DRAFT_LIMITS,
  VOXEL_AUTHORING_DRAFT_VERSION,
  buildVoxelAuthoringPage,
  buildVoxelCountingScene,
  buildVoxelLessonScene,
  buildVoxelLessonPage,
  canonicalJsonStringify,
  compileVoxelCountingScene,
  compileVoxelLessonScene,
  createDefaultVoxelAuthoringDraft,
  createDefaultVoxelLessonPlan,
  parseVoxelAuthoringDraft,
  replaceVoxelAuthoringLesson,
  replaceVoxelAuthoringModel,
  voxelAuthoringDraftHash,
} from "@/features/spatial-math/domain";
import { voxelCountingAdapterInput } from "./fixtures/spatial-voxel-scene";

function oneCellPerLayerInput(layerCount: number) {
  return {
    ...voxelCountingAdapterInput(),
    sceneId: `scene.voxel-counting.layers-${layerCount}`,
    cells: Array.from({ length: layerCount }, (_, y) => ({ x: 0, y, z: 0 })),
  };
}

describe("voxel-authoring-draft-v1", () => {
  it("creates a strict unified model and lesson draft with a deterministic hash", async () => {
    const input = voxelCountingAdapterInput();
    const draft = createDefaultVoxelAuthoringDraft(input);

    expect(draft).toMatchObject({
      draftVersion: VOXEL_AUTHORING_DRAFT_VERSION,
      model: input,
      lesson: { planVersion: "voxel-lesson-plan-v1" },
    });
    expect(draft.lesson.steps[0]).toMatchObject({
      id: "step.predict",
      kind: "predict",
      teacherPrompt: input.teacherPrompt,
    });

    const firstHash = await voxelAuthoringDraftHash(draft);
    const secondHash = await voxelAuthoringDraftHash({
      lesson: draft.lesson,
      model: draft.model,
      draftVersion: draft.draftVersion,
    });
    expect(firstHash).toMatch(/^[0-9a-f]{64}$/);
    expect(secondHash).toBe(firstHash);
  });

  it("rejects direct prompt drift, missing predict prompts and derived-state injection", () => {
    const draft = createDefaultVoxelAuthoringDraft(voxelCountingAdapterInput());
    expect(() =>
      parseVoxelAuthoringDraft({
        ...draft,
        model: { ...draft.model, teacherPrompt: { zh: "已经漂移的模型提示" } },
      }),
    ).toThrow(/must mirror/);

    expect(() =>
      parseVoxelAuthoringDraft({
        ...draft,
        lesson: {
          ...draft.lesson,
          steps: draft.lesson.steps.map((step) =>
            step.kind === "predict"
              ? { id: step.id, kind: step.kind, title: step.title }
              : step,
          ),
        },
      }),
    ).toThrow(/requires teacherPrompt/);

    for (const field of ["page", "sceneHash", "runtime", "compiledSteps", "presetId"]) {
      expect(() => parseVoxelAuthoringDraft({ ...draft, [field]: {} })).toThrow();
    }
  });

  it("delegates page materialization to the existing lesson builder and stays standard 4:3", async () => {
    const input = voxelCountingAdapterInput();
    const draft = createDefaultVoxelAuthoringDraft(input);
    const unified = await buildVoxelAuthoringPage(draft);
    const direct = await buildVoxelLessonPage(input, draft.lesson);
    const legacy = await buildVoxelCountingScene(input);

    expect(unified).toEqual(direct);
    expect(unified.page.layout).toEqual({ profile: "standard-4x3" });
    expect(unified.page.presentation.viewport).toMatchObject({ width: 1_200, height: 900 });
    expect(unified.sceneHash).not.toBe(legacy.sceneHash);
    expect(legacy.scene.learning.teacherPrompts).toEqual([input.teacherPrompt]);
  });

  it("keeps the extracted synchronous compilers identical to legacy async outputs", async () => {
    const input = voxelCountingAdapterInput();
    const lessonPlan = createDefaultVoxelLessonPlan(input.teacherPrompt);
    const compiledBase = compileVoxelCountingScene(input);
    const builtBase = await buildVoxelCountingScene(input);
    const compiledLesson = compileVoxelLessonScene(input, lessonPlan);
    const builtLesson = await buildVoxelLessonScene(input, lessonPlan);
    const { sceneHash: baseHash, ...baseWithoutHash } = builtBase;
    const { sceneHash: lessonHash, ...lessonWithoutHash } = builtLesson;

    expect(baseWithoutHash).toEqual(compiledBase);
    expect(lessonWithoutHash).toEqual(compiledLesson);
    expect(baseHash).toBe("b860667157a075c7e8e75d929543e542cf3e6d7dbe9f375087d781903ea343a4");
    expect(lessonHash).toBe("dcf92339cecccfafab1e3255163850404bcf5cae74aea644c84bb31a503b4a75");
  });

  it("rejects drafts whose layer expansion exceeds the scene budget and accepts the fixed boundary vector", async () => {
    const rejectedModel = oneCellPerLayerInput(99);
    const rejectedPlan = createDefaultVoxelLessonPlan(rejectedModel.teacherPrompt);
    expect(() => parseVoxelAuthoringDraft({
      draftVersion: VOXEL_AUTHORING_DRAFT_VERSION,
      model: rejectedModel,
      lesson: rejectedPlan,
    })).toThrow(VOXEL_AUTHORING_DRAFT_ISSUES.compile);

    const accepted = createDefaultVoxelAuthoringDraft(oneCellPerLayerInput(85));
    const built = await buildVoxelAuthoringPage(accepted);
    expect(built.layerCounts).toHaveLength(85);
    expect(built.compiledSteps.find((step) => step.lessonStepId === "step.layers")?.sceneStepIds).toHaveLength(85);
    expect(built.page.layout).toEqual({ profile: "standard-4x3" });
  });

  it("atomically replaces model data while preserving the lesson prompt authority", async () => {
    const draft = createDefaultVoxelAuthoringDraft(voxelCountingAdapterInput());
    const before = canonicalJsonStringify(draft);
    const replacement = {
      ...draft.model,
      teacherPrompt: { zh: "模型编辑器中的过期镜像" },
      layerAxis: "z" as const,
      cells: [...draft.model.cells, { x: 3, y: 0, z: 0 }],
    };
    const updated = replaceVoxelAuthoringModel(draft, replacement);

    expect(canonicalJsonStringify(draft)).toBe(before);
    expect(updated.model.teacherPrompt).toEqual(draft.lesson.steps[0].teacherPrompt);
    expect(updated.model.cells).toHaveLength(draft.model.cells.length + 1);
    expect(updated.model.layerAxis).toBe("z");

    const built = await buildVoxelAuthoringPage(updated);
    expect(built.totalCount).toBe(11);
    expect(built.compiledSteps.find((step) => step.lessonStepId === "step.layers")?.sceneStepIds).toHaveLength(2);

    expect(() =>
      replaceVoxelAuthoringModel(draft, {
        ...replacement,
        cells: [...replacement.cells].reverse(),
      }),
    ).toThrow(/stable coordinate order/);
    expect(canonicalJsonStringify(draft)).toBe(before);
  });

  it("atomically replaces a lesson and synchronizes its predict prompt into the model mirror", async () => {
    const draft = createDefaultVoxelAuthoringDraft(voxelCountingAdapterInput());
    const before = canonicalJsonStringify(draft);
    const predict = draft.lesson.steps.find((step) => step.kind === "predict")!;
    const right = draft.lesson.steps.find((step) => step.kind === "view" && step.camera === "right")!;
    const layers = draft.lesson.steps.find((step) => step.kind === "layer-scan")!;
    const verify = draft.lesson.steps.find((step) => step.kind === "verify")!;
    const teacherPrompt = { zh: "先从右面预测隐藏的单位块。", en: "Predict hidden cubes from the right." };
    const lesson = {
      ...draft.lesson,
      steps: [
        { ...predict, teacherPrompt },
        right,
        { ...layers, order: "descending" as const },
        verify,
      ],
      checkpoint: {
        prompt: { zh: "写出新的总数判断。", en: "Give the revised total." },
        required: false,
        maxSubmissions: 5,
      },
    };
    const updated = replaceVoxelAuthoringLesson(draft, lesson);

    expect(canonicalJsonStringify(draft)).toBe(before);
    expect(updated.model.teacherPrompt).toEqual(teacherPrompt);
    expect(updated.lesson.steps.map((step) => step.id)).toEqual([
      "step.predict",
      "step.right",
      "step.layers",
      "step.verify",
    ]);

    const built = await buildVoxelAuthoringPage(updated);
    expect(built.scene.sequence.steps[1]).toMatchObject({ id: "step.right" });
    expect(built.scene.learning.teacherPrompts[0]).toEqual(teacherPrompt);
    expect(built.page.learningCheck).toMatchObject({
      items: [{ checkpointId: "checkpoint.total-count", required: false, evaluation: "server-pinned-kernel" }],
      maxSubmissions: 5,
    });

    const missingPrompt = {
      ...lesson,
      steps: lesson.steps.map((step) =>
        step.kind === "predict"
          ? { id: step.id, kind: step.kind, title: step.title }
          : step,
      ),
    };
    expect(() => replaceVoxelAuthoringLesson(draft, missingPrompt)).toThrow(/requires teacherPrompt/);
    expect(canonicalJsonStringify(draft)).toBe(before);
  });

  it("enforces the canonical UTF-8 512 KiB gate", () => {
    const cells: { x: number; y: number; z: number }[] = [];
    for (let x = -1_024; x < -1_008; x += 1) {
      for (let y = -1_024; y < -992; y += 1) {
        for (let z = -1_024; z < -1_008; z += 1) {
          cells.push({ x, y, z });
        }
      }
    }
    // JSON escapes lone UTF-16 surrogates as six ASCII bytes. The schema must
    // measure the canonical UTF-8 payload, not JavaScript string length.
    const maximumText = { zh: "\uD800".repeat(2_000), en: "\uD800".repeat(2_000) };
    const layerTitle = { zh: "\uD800".repeat(1_990), en: "\uD800".repeat(1_990) };
    const stableTermIds = Array.from(
      { length: 32 },
      (_, index) => `t${String(index).padStart(2, "0")}.${"a".repeat(76)}`,
    );
    const base = createDefaultVoxelAuthoringDraft(voxelCountingAdapterInput());
    const oversized = {
      ...base,
      model: {
        ...base.model,
        title: maximumText,
        learningGoal: maximumText,
        teacherPrompt: maximumText,
        misconception: maximumText,
        cells,
        termIds: stableTermIds,
        prerequisiteTermIds: stableTermIds,
      },
      lesson: {
        ...base.lesson,
        steps: base.lesson.steps.map((step) => ({
          ...step,
          title: step.kind === "layer-scan" ? layerTitle : maximumText,
          teacherPrompt: maximumText,
        })),
        checkpoint: { ...base.lesson.checkpoint, prompt: maximumText },
      },
    };
    const bytes = new TextEncoder().encode(canonicalJsonStringify(oversized)).byteLength;

    expect(cells).toHaveLength(8_192);
    expect(bytes).toBeGreaterThan(VOXEL_AUTHORING_DRAFT_LIMITS.maxBytes);
    expect(() => parseVoxelAuthoringDraft(oversized)).toThrow(/authoring draft size/);
  });
});

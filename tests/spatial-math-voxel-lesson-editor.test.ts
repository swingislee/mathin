import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildVoxelCountingScene,
  buildVoxelLessonPage,
  buildVoxelLessonScene,
  createDefaultVoxelLessonPlan,
  createInitialSpatialRuntimeState,
  parseVoxelLessonPlan,
} from "@/features/spatial-math/domain";
import {
  applyVoxelLessonEditorAction,
  createVoxelLessonEditorState,
  createVoxelLessonPreviewState,
  deriveVoxelLessonEditorView,
  resolveVoxelLessonPreviewStepId,
  VOXEL_LESSON_EDITOR_ERROR_CODES,
} from "@/features/spatial-math/editor";
import { buildVoxelRenderModel } from "@/features/spatial-math/renderer-r3f";
import { voxelCountingAdapterInput } from "./fixtures/spatial-voxel-scene";

describe("voxel-lesson-plan-v1 and voxel-lesson-editor-v1", () => {
  it("compiles the default lesson without changing the legacy voxel adapter contract", async () => {
    const input = voxelCountingAdapterInput();
    const plan = createDefaultVoxelLessonPlan(input.teacherPrompt);
    const base = await buildVoxelCountingScene(input);
    const lesson = await buildVoxelLessonScene(input, plan);

    expect(plan.steps.map((step) => step.kind)).toEqual([
      "predict",
      "view",
      "view",
      "view",
      "layer-scan",
      "verify",
    ]);
    expect(lesson.scene.model).toEqual(base.scene.model);
    expect(lesson.scene.presentation).toEqual(base.scene.presentation);
    expect(lesson.scene.sequence).toEqual(base.scene.sequence);
    expect(lesson.scene.checkpoints).toEqual(base.scene.checkpoints);
    expect(base.scene.learning.teacherPrompts).toEqual([input.teacherPrompt]);
    expect(lesson.scene.learning.teacherPrompts).toEqual([
      input.teacherPrompt,
      expect.objectContaining({ zh: "把各层数量相加，再与整体核对。" }),
    ]);
    expect(lesson.sceneHash).not.toBe(base.sceneHash);
    expect(lesson.compiledSteps.find((step) => step.lessonStepId === "step.layers")?.sceneStepIds).toEqual([
      "step.layer.001",
      "step.layer.002",
      "step.layer.003",
    ]);
  });

  it("reorders only unique authored views while preserving fixed lesson boundaries", () => {
    let state = createVoxelLessonEditorState(undefined, voxelCountingAdapterInput().teacherPrompt);
    state = applyVoxelLessonEditorAction(state, { kind: "step.move", stepId: "step.right", direction: "up" });
    expect(state.plan.steps.map((step) => step.id)).toEqual([
      "step.predict",
      "step.right",
      "step.front",
      "step.top",
      "step.layers",
      "step.verify",
    ]);
    expect(state.selectedStepId).toBe("step.right");
    expect(() =>
      applyVoxelLessonEditorAction(state, { kind: "step.move", stepId: "step.layers", direction: "up" }),
    ).toThrow(expect.objectContaining({ code: VOXEL_LESSON_EDITOR_ERROR_CODES.fixedStep }));

    const duplicate = applyVoxelLessonEditorAction(state, { kind: "step.add-view", camera: "right" });
    expect(duplicate).toBe(state);
  });

  it("keeps at least one view and supports undo, redo and reset as authored history", () => {
    let state = createVoxelLessonEditorState(undefined, voxelCountingAdapterInput().teacherPrompt);
    state = applyVoxelLessonEditorAction(state, { kind: "step.remove", stepId: "step.top" });
    state = applyVoxelLessonEditorAction(state, { kind: "step.remove", stepId: "step.right" });
    expect(deriveVoxelLessonEditorView(state).steps.filter((step) => step.kind === "view")).toHaveLength(1);
    expect(() =>
      applyVoxelLessonEditorAction(state, { kind: "step.remove", stepId: "step.front" }),
    ).toThrow(expect.objectContaining({ code: VOXEL_LESSON_EDITOR_ERROR_CODES.observationRequired }));

    state = applyVoxelLessonEditorAction(state, {
      kind: "step.text.set",
      stepId: "step.front",
      field: "title",
      locale: "zh",
      value: "只看正面",
    });
    expect(deriveVoxelLessonEditorView(state)).toMatchObject({ canUndo: true, canRedo: false, isDirty: true });
    state = applyVoxelLessonEditorAction(state, { kind: "history.undo" });
    expect(state.plan.steps.find((step) => step.id === "step.front")?.title.zh).toBe("看正面");
    state = applyVoxelLessonEditorAction(state, { kind: "history.redo" });
    expect(state.plan.steps.find((step) => step.id === "step.front")?.title.zh).toBe("只看正面");
    state = applyVoxelLessonEditorAction(state, { kind: "draft.reset" });
    expect(deriveVoxelLessonEditorView(state).isDirty).toBe(false);
    expect(state.plan.steps.filter((step) => step.kind === "view")).toHaveLength(3);
  });

  it("bounds authored history to fifty snapshots and clears redo after a branch", () => {
    let state = createVoxelLessonEditorState(undefined, voxelCountingAdapterInput().teacherPrompt);
    for (let index = 0; index < 55; index += 1) {
      state = applyVoxelLessonEditorAction(state, {
        kind: "step.text.set",
        stepId: "step.front",
        field: "title",
        locale: "zh",
        value: `正面观察 ${index + 1}`,
      });
    }
    expect(state.past).toHaveLength(50);
    state = applyVoxelLessonEditorAction(state, { kind: "history.undo" });
    expect(state.future).toHaveLength(1);
    state = applyVoxelLessonEditorAction(state, {
      kind: "checkpoint.prompt.set",
      locale: "zh",
      value: "分支后的新问题",
    });
    expect(state.future).toHaveLength(0);
  });

  it("expands descending layers into absolute, directly previewable scene steps", async () => {
    const input = voxelCountingAdapterInput();
    let state = createVoxelLessonEditorState(undefined, input.teacherPrompt);
    state = applyVoxelLessonEditorAction(state, { kind: "layers.order.set", order: "descending" });
    const built = await buildVoxelLessonScene(input, state.plan);
    const layerIds = built.scene.presentation.layers.map((layer) => layer.id);
    const layerSteps = built.scene.sequence.steps.filter((step) => step.id.startsWith("step.layer."));

    expect(layerSteps).toHaveLength(3);
    expect(layerSteps[0].actions.filter((action) => action.kind === "layer.set")).toHaveLength(layerIds.length);
    expect(
      layerSteps[0].actions.find((action) => action.kind === "layer.set" && action.visible),
    ).toMatchObject({ layerId: layerIds.at(-1), visible: true });
    expect(layerSteps[0].title).toEqual({
      zh: `观察第 ${layerIds.length} 层`,
      en: `Observe layer ${layerIds.length}`,
    });
    for (const step of built.scene.sequence.steps) {
      expect(step.actions.filter((action) => action.kind === "camera.apply")).toHaveLength(1);
      expect(step.actions.filter((action) => action.kind === "layer.set")).toHaveLength(layerIds.length);
    }
  });

  it("keeps authored step prompts and scene learning metadata in sync", async () => {
    const input = voxelCountingAdapterInput();
    let state = createVoxelLessonEditorState(undefined, input.teacherPrompt);
    state = applyVoxelLessonEditorAction(state, {
      kind: "step.text.set",
      stepId: "step.front",
      field: "teacherPrompt",
      locale: "zh",
      value: "先描述正面轮廓。",
    });
    const built = await buildVoxelLessonScene(input, state.plan);

    expect(built.scene.learning.teacherPrompts).toEqual(
      state.plan.steps.flatMap((step) => step.teacherPrompt ? [step.teacherPrompt] : []),
    );
    expect(built.scene.sequence.steps.find((step) => step.id === "step.front")?.teacherPrompt).toEqual({
      zh: "先描述正面轮廓。",
    });
  });

  it("requires Chinese before an optional English prompt and lets English fallbacks be cleared", () => {
    let state = createVoxelLessonEditorState(undefined, voxelCountingAdapterInput().teacherPrompt);
    expect(() => applyVoxelLessonEditorAction(state, {
      kind: "step.text.set",
      stepId: "step.front",
      field: "teacherPrompt",
      locale: "en",
      value: "Describe the front.",
    })).toThrow(expect.objectContaining({ code: VOXEL_LESSON_EDITOR_ERROR_CODES.textInvalid }));

    state = applyVoxelLessonEditorAction(state, {
      kind: "step.text.set",
      stepId: "step.front",
      field: "teacherPrompt",
      locale: "zh",
      value: "描述正面。",
    });
    state = applyVoxelLessonEditorAction(state, {
      kind: "step.text.set",
      stepId: "step.front",
      field: "teacherPrompt",
      locale: "en",
      value: "Describe the front.",
    });
    state = applyVoxelLessonEditorAction(state, {
      kind: "step.text.set",
      stepId: "step.front",
      field: "title",
      locale: "en",
      value: "",
    });

    const front = state.plan.steps.find((step) => step.id === "step.front");
    expect(front?.teacherPrompt).toEqual({ zh: "描述正面。", en: "Describe the front." });
    expect(front?.title).toEqual({ zh: "看正面" });
  });

  it("keeps the layer-title schema closed under compiled ordinal suffixes", async () => {
    const input = voxelCountingAdapterInput();
    const valid = createDefaultVoxelLessonPlan(input.teacherPrompt);
    const atLimit = {
      ...valid,
      steps: valid.steps.map((step) =>
        step.kind === "layer-scan"
          ? { ...step, title: { zh: "层".repeat(1_990), en: "L".repeat(1_990) } }
          : step,
      ),
    };

    expect(parseVoxelLessonPlan(atLimit)).toBeDefined();
    await expect(buildVoxelLessonScene(input, atLimit)).resolves.toBeDefined();
    expect(() => parseVoxelLessonPlan({
      ...atLimit,
      steps: atLimit.steps.map((step) =>
        step.kind === "layer-scan" ? { ...step, title: { zh: "层".repeat(1_991) } } : step,
      ),
    })).toThrow();
  });

  it("edits only checkpoint policy fields while pinning evaluator, fallback and 4:3 layout", async () => {
    const input = voxelCountingAdapterInput();
    let state = createVoxelLessonEditorState(undefined, input.teacherPrompt);
    state = applyVoxelLessonEditorAction(state, { kind: "checkpoint.required.toggle" });
    state = applyVoxelLessonEditorAction(state, { kind: "checkpoint.max-submissions.set", value: 5 });
    state = applyVoxelLessonEditorAction(state, {
      kind: "checkpoint.prompt.set",
      locale: "zh",
      value: "请写出单位正方体总数。",
    });
    const built = await buildVoxelLessonPage(input, state.plan);

    expect(built.page.layout).toEqual({ profile: "standard-4x3" });
    expect(built.page.presentation.viewport).toMatchObject({ width: 1_200, height: 900 });
    expect(built.page.scene.checkpoints).toEqual([
      expect.objectContaining({
        id: "checkpoint.total-count",
        type: "numeric",
        prompt: expect.objectContaining({ zh: "请写出单位正方体总数。" }),
        revealPolicy: "after-submit",
        responseFormat: "integer",
        evaluator: { kind: "derived", query: { kind: "voxel.total", entityId: input.entityId } },
      }),
    ]);
    expect(built.page.learningCheck).toMatchObject({
      mode: "formative-only",
      items: [{ checkpointId: "checkpoint.total-count", required: false, evaluation: "server-pinned-kernel" }],
      maxSubmissions: 5,
    });
    expect(built.page.fallback.checkpoints).toEqual([
      { checkpointId: "checkpoint.total-count", mode: "interactive-2d" },
    ]);
  });

  it("previews a selected logical step through the real runtime reducer", async () => {
    const input = voxelCountingAdapterInput();
    const plan = createDefaultVoxelLessonPlan(input.teacherPrompt);
    const built = await buildVoxelLessonPage(input, plan);

    const frontState = await createVoxelLessonPreviewState(built.page, built.compiledSteps, "step.front");
    expect(frontState).toMatchObject({ activeStepId: "step.front", cameraBookmarkId: "camera.front" });

    const layerState = await createVoxelLessonPreviewState(built.page, built.compiledSteps, "step.layers");
    expect(layerState.activeStepId).toBe("step.layer.001");
    expect(layerState.layerVisibility.filter((layer) => layer.visible)).toHaveLength(1);
    expect(buildVoxelRenderModel(built.page, layerState, input.entityId, "zh").layers[0].countRevealed).toBe(true);

    const fallbackId = resolveVoxelLessonPreviewStepId(built.page, built.compiledSteps, "missing.step");
    expect(fallbackId).toBe("step.predict");
    expect(await createVoxelLessonPreviewState(built.page, [], "missing.step")).toEqual(
      createInitialSpatialRuntimeState(built.page),
    );
  });

  it("rejects malformed topology, repeated cameras and editable evaluator injection", () => {
    const valid = createDefaultVoxelLessonPlan(voxelCountingAdapterInput().teacherPrompt);
    expect(() => parseVoxelLessonPlan({ ...valid, steps: [...valid.steps].reverse() })).toThrow();
    expect(() =>
      parseVoxelLessonPlan({
        ...valid,
        steps: valid.steps.map((step) =>
          step.id === "step.right" && step.kind === "view" ? { ...step, camera: "front" } : step,
        ),
      }),
    ).toThrow();
    expect(() => parseVoxelLessonPlan({ ...valid, checkpoint: { ...valid.checkpoint, evaluator: "client" } })).toThrow();
  });

  it("keeps the lesson editor a preproduction shadcn leaf with one 4:3 preview", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/features/spatial-math/editor/VoxelLessonEditorStage.tsx"),
      "utf8",
    );
    expect(source).toContain('data-spatial-editor="voxel-lesson-editor-v1"');
    expect(source).toContain('data-editor-preview="standard-4x3"');
    expect(source).toContain("<Button");
    expect(source).toContain("<Input");
    expect(source).toContain("<Textarea");
    expect(source).toContain("<Tabs");
    expect(source).toContain("<VoxelTeachingStage");
    expect(source).toContain("maxLength=");
    expect(source).toContain("useId");
    expect(source).not.toContain("<input");
    expect(source).not.toContain("<select");
    expect(source).not.toContain("<textarea");
    expect(source).not.toContain("wide-16x9-exception");
    expect(source).not.toContain("session_events");
    expect(source).not.toContain("supabase");
  });
});

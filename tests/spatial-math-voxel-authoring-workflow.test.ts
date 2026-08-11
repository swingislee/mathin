import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildVoxelAuthoringPage,
  createDefaultVoxelAuthoringDraft,
  parseSpatialPageDoc,
} from "@/features/spatial-math/domain";
import {
  VOXEL_EDITOR_STANDARD_PAGE_ERROR,
  applyVoxelAuthoringWorkflowAction,
  applyVoxelLessonEditorAction,
  assertVoxelEditorStandard4x3Page,
  buildVoxelAuthoringWorkflowPage,
  createDefaultVoxelAuthoringWorkflowState,
  createVoxelLessonEditorState,
  deriveVoxelTemplateEditorView,
  voxelTemplateEditorPreviewKey,
} from "@/features/spatial-math/editor";
import { voxelCountingAdapterInput } from "./fixtures/spatial-voxel-scene";

describe("voxel-authoring-workflow-v1", () => {
  it("keeps both editor histories and authored state while switching one mounted panel", () => {
    let state = createDefaultVoxelAuthoringWorkflowState(voxelCountingAdapterInput());
    const initialPreviewKey = voxelTemplateEditorPreviewKey(state.draft.model, "injected");
    expect(state).toMatchObject({ workflowVersion: "voxel-authoring-workflow-v1", panel: "model" });

    state = applyVoxelAuthoringWorkflowAction(state, {
      kind: "model.apply",
      action: { kind: "layer.select", coordinate: 2 },
    });
    state = applyVoxelAuthoringWorkflowAction(state, {
      kind: "model.apply",
      action: { kind: "cell.toggle", u: 0, v: 0 },
    });
    expect(deriveVoxelTemplateEditorView(state.modelEditor).totalCount).toBe(9);
    expect(state.modelEditor.past).toHaveLength(1);
    expect(voxelTemplateEditorPreviewKey(state.draft.model, "injected")).not.toBe(initialPreviewKey);
    expect(voxelTemplateEditorPreviewKey(state.draft.model, "default")).not.toBe(
      voxelTemplateEditorPreviewKey(state.draft.model, "injected"),
    );

    state = applyVoxelAuthoringWorkflowAction(state, {
      kind: "panel.select",
      panel: "lesson",
    });
    state = applyVoxelAuthoringWorkflowAction(state, {
      kind: "lesson.apply",
      action: { kind: "step.move", stepId: "step.right", direction: "up" },
    });
    expect(state.lessonEditor.past).toHaveLength(1);
    expect(state.draft.lesson.steps.map((step) => step.id).slice(0, 3)).toEqual([
      "step.predict",
      "step.right",
      "step.front",
    ]);

    state = applyVoxelAuthoringWorkflowAction(state, { kind: "panel.select", panel: "model" });
    expect(state.panel).toBe("model");
    expect(state.modelEditor.past).toHaveLength(1);
    expect(state.lessonEditor.past).toHaveLength(1);
    expect(state.draft.model.cells).toHaveLength(9);
  });

  it("rebuilds the lesson from the current model without a removed layer", async () => {
    let state = createDefaultVoxelAuthoringWorkflowState(voxelCountingAdapterInput());
    const before = await buildVoxelAuthoringWorkflowPage(state);
    const removedLayerId = before.page.scene.presentation.layers.at(-1)?.id;
    expect(before.page.scene.presentation.layers).toHaveLength(3);

    state = applyVoxelAuthoringWorkflowAction(state, {
      kind: "model.apply",
      action: { kind: "layer.select", coordinate: 2 },
    });
    state = applyVoxelAuthoringWorkflowAction(state, {
      kind: "model.apply",
      action: { kind: "cell.toggle", u: 0, v: 0 },
    });
    const built = await buildVoxelAuthoringWorkflowPage(state);
    const layerScan = built.compiledSteps.find((entry) => entry.lessonStepId === "step.layers");
    const compiledLayerIds = built.page.scene.sequence.steps.flatMap((step) =>
      step.actions.flatMap((action) => action.kind === "layer.set" ? [action.layerId] : []),
    );

    expect(built.totalCount).toBe(9);
    expect(built.page.layout).toEqual({ profile: "standard-4x3" });
    expect(built.page.presentation.viewport).toMatchObject({ width: 1_200, height: 900 });
    expect(built.page.scene.presentation.layers).toHaveLength(2);
    expect(layerScan?.sceneStepIds).toHaveLength(2);
    expect(built.page.scene.presentation.layers.map((layer) => layer.id)).not.toContain(removedLayerId);
    expect(compiledLayerIds).not.toContain(removedLayerId);
  });

  it("keeps the lesson predict prompt authoritative and mirrors it into the model", () => {
    let state = createDefaultVoxelAuthoringWorkflowState(voxelCountingAdapterInput());
    state = applyVoxelAuthoringWorkflowAction(state, {
      kind: "lesson.apply",
      action: {
        kind: "step.text.set",
        stepId: "step.predict",
        field: "teacherPrompt",
        locale: "zh",
        value: "先猜，再说明哪些单位块可能被挡住。",
      },
    });

    const predict = state.draft.lesson.steps[0];
    expect(predict.kind).toBe("predict");
    expect(predict.teacherPrompt?.zh).toBe("先猜，再说明哪些单位块可能被挡住。");
    expect(state.draft.model.teacherPrompt).toEqual(predict.teacherPrompt);
    expect(state.modelEditor.draft.teacherPrompt).toEqual(predict.teacherPrompt);

    state = applyVoxelAuthoringWorkflowAction(state, {
      kind: "model.apply",
      action: { kind: "cell.toggle", u: 4, v: 4 },
    });
    expect(state.draft.model.teacherPrompt).toEqual(state.draft.lesson.steps[0].teacherPrompt);
    expect(() => applyVoxelAuthoringWorkflowAction(state, {
      kind: "lesson.apply",
      action: {
        kind: "step.text.set",
        stepId: "step.predict",
        field: "teacherPrompt",
        locale: "zh",
        value: "",
      },
    })).toThrow();
  });

  it("leaves the standalone lesson reducer optional-English behavior compatible", () => {
    const input = voxelCountingAdapterInput();
    const standalone = applyVoxelLessonEditorAction(
      createVoxelLessonEditorState(undefined, input.teacherPrompt),
      {
        kind: "step.text.set",
        stepId: "step.predict",
        field: "teacherPrompt",
        locale: "en",
        value: "",
      },
    );
    expect(standalone.plan.steps[0].teacherPrompt).toEqual({ zh: input.teacherPrompt.zh });
    expect(createDefaultVoxelAuthoringDraft(input).model).toEqual(input);
  });

  it("accepts only standard-4x3 1200x900 pages at the editor preview boundary", async () => {
    const page = (await buildVoxelAuthoringPage(
      createDefaultVoxelAuthoringDraft(voxelCountingAdapterInput()),
    )).page;
    const wide = parseSpatialPageDoc({
      ...page,
      layout: {
        profile: "wide-16x9-exception",
        reason: { zh: "只用于验证编辑器拒绝宽屏注入。", en: "Only verifies wide injection rejection." },
      },
      presentation: {
        ...page.presentation,
        viewport: { ...page.presentation.viewport, width: 1_600, height: 900 },
      },
    });
    const resizedStandard = parseSpatialPageDoc({
      ...page,
      presentation: {
        ...page.presentation,
        viewport: { ...page.presentation.viewport, width: 800, height: 600 },
      },
    });

    expect(() => assertVoxelEditorStandard4x3Page(page)).not.toThrow();
    expect(() => assertVoxelEditorStandard4x3Page(wide)).toThrow(VOXEL_EDITOR_STANDARD_PAGE_ERROR);
    expect(() => assertVoxelEditorStandard4x3Page(resizedStandard)).toThrow(
      VOXEL_EDITOR_STANDARD_PAGE_ERROR,
    );
  });

  it("keeps the unmounted composition isolated, shadcn-based and single-preview", () => {
    const root = process.cwd();
    const workflowSource = readFileSync(
      resolve(root, "src/features/spatial-math/editor/VoxelAuthoringWorkflowStage.tsx"),
      "utf8",
    );
    const templateSource = readFileSync(
      resolve(root, "src/features/spatial-math/editor/VoxelTemplateEditorStage.tsx"),
      "utf8",
    );
    const lessonSource = readFileSync(
      resolve(root, "src/features/spatial-math/editor/VoxelLessonEditorStage.tsx"),
      "utf8",
    );
    const indexSource = readFileSync(
      resolve(root, "src/features/spatial-math/editor/index.ts"),
      "utf8",
    );

    expect(workflowSource).toContain('data-spatial-editor="voxel-authoring-workflow-v1"');
    expect(workflowSource).toContain('data-layout-profile="standard-4x3"');
    expect(workflowSource).toContain("<Tabs");
    expect(workflowSource).toContain("<Card");
    expect(workflowSource).toContain('workflow.panel === "model"');
    expect(workflowSource).toContain("pageBuilder={buildModelPage}");
    expect(workflowSource).toContain("buildVoxelAuthoringPage");
    expect(workflowSource).toContain("requirePredictPrompt");
    expect(workflowSource).not.toContain("forceMount");
    expect(workflowSource).not.toContain("data-editor-preview");
    expect(templateSource).toContain("pageBuilder ?? buildVoxelCountingPage");
    expect(templateSource).toContain("voxelTemplateEditorPreviewKey");
    expect(templateSource).toContain("preview.key === buildKey && preview.builder === buildPage");
    expect(templateSource).toContain("requestKey !== buildKey || requestBuilder !== buildPage");
    expect(templateSource).toContain("assertVoxelEditorStandard4x3Page(built.page)");
    expect(lessonSource).toContain("pageBuilder ?? buildVoxelLessonPage");
    expect(lessonSource).toContain("requestKey !== buildKey || requestBuilder !== buildPage");
    expect(lessonSource).toContain('readyLesson?.page.sceneHash ?? "pending"');
    expect(lessonSource).toContain("preview.builder === buildPage");
    expect(lessonSource).toContain("assertVoxelEditorStandard4x3Page(built.page)");
    expect(lessonSource).toContain("requestKey !== previewKey || requestBuilder !== buildPage");
    expect(lessonSource).toContain("aria-required={promptRequired || undefined}");
    expect(lessonSource).toContain("requirePredictPrompt = false");
    expect(indexSource).toContain('export * from "./voxel-authoring-workflow"');
    expect(indexSource).toContain('export * from "./VoxelAuthoringWorkflowStage"');

    for (const source of [workflowSource, templateSource, lessonSource]) {
      expect(source).not.toContain("<input");
      expect(source).not.toContain("<select");
      expect(source).not.toContain("<textarea");
      expect(source).not.toContain("wide-16x9-exception");
      expect(source).not.toContain("session_events");
      expect(source).not.toContain("supabase");
      expect(source).not.toContain("fetch(");
      expect(source).not.toContain("CoursewareDoc");
    }
  });
});

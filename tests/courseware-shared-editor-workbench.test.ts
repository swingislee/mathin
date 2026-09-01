import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("shared courseware editor workbench", () => {
  it("uses one workbench contract for preview, formal authoring and teacher compositions", () => {
    const shared = read("src", "features", "courseware-doc", "CoursewareEditorWorkbench.tsx");
    const formal = read("src", "features", "courseware-studio", "UnifiedCoursewareWorkspace.tsx");
    const microcourse = read("src", "features", "teacher-microcourses", "MicrocourseEditor.tsx");
    const preview = read("src", "features", "school", "curriculum", "LectureCoursewarePreview.tsx");

    expect(shared).toContain("function CoursewareWorkbench");
    expect(shared).toContain('"preview" | "formal-editor" | "microcourse-editor"');
    expect(shared).toContain("data-courseware-editor-workbench");
    expect(shared).toContain("<Card");
    expect(formal).toContain("<CoursewareWorkbench");
    expect(microcourse).toContain("<CoursewareWorkbench");
    expect(preview).toContain("<CoursewareWorkbench");
    expect(formal).toContain('mode="formal-editor"');
    expect(microcourse).toContain('mode="microcourse-editor"');
    expect(preview).toContain('mode="preview"');
    expect(shared).toContain("data-courseware-editor-adapter={adapter}");
    expect(shared).toContain('data-courseware-editor-slot="directory"');
    expect(shared).toContain('data-courseware-editor-slot="toolbar"');
    expect(shared).toContain('data-courseware-editor-slot="canvas"');
    expect(shared).toContain('data-courseware-editor-slot="inspector"');
    expect(shared).toContain('data-courseware-editor-part="save-controls"');
    expect(shared).toContain('data-courseware-editor-slot="inspector-header"');
    expect(shared).toContain('<ResizablePanel\n            id="directory"');
    expect(shared).toContain('<ResizablePanel\n            id="canvas"');
    expect(shared).toContain('id="inspector"');
    expect(formal).toContain('layout="workspace"');
    expect(microcourse).toContain('layout="viewport"');
    expect(shared).toContain('data-courseware-editor-adapt-4x3={mode === "formal-editor" ? "enabled" : "disabled"}');
    expect(formal).toContain("adapter={selectedDoc?.docVersion");
    expect(microcourse).toContain('adapter="courseware-composition-v1"');
  });

  it("shares editor shell, insertion toolbar, canvas and inspector composition", () => {
    const shared = read("src", "features", "courseware-doc", "CoursewareEditorWorkbench.tsx");
    const adapterSurface = read("src", "features", "courseware-doc", "CoursewareEditorAdapterSurface.tsx");
    const composition = read("src", "features", "teacher-microcourses", "CoursewareCompositionWorkbench.tsx");
    const pageDoc = read("src", "features", "courseware-studio", "PageDocVerticalSliceEditor.tsx");

    for (const primitive of [
      "CoursewareEditorActionGrid",
      "CoursewareEditorToolbar",
      "CoursewareEditorToolbarButton",
      "CoursewareEditorToolbarLabel",
      "CoursewareInsertionToolbar",
      "CoursewareEditorSaveControls",
    ]) expect(shared).toContain(`function ${primitive}`);
    expect(adapterSurface).toContain("<CoursewareStageViewport");
    expect(adapterSurface).toContain("useCoursewareEditorChrome");
    expect(adapterSurface).not.toContain("createPortal");
    expect(adapterSurface).not.toContain("getElementById");
    expect(composition).toContain("<CoursewareEditorAdapterSurface");
    expect(pageDoc).toContain("<CoursewareEditorAdapterSurface");
    expect(composition).toContain("<CoursewareInsertionToolbar");
    expect(composition).toContain("<CoursewareEditorSaveControls");
    expect(composition).toContain("<CoursewareEditorToolbarButton");
    expect(pageDoc).toContain("<CoursewareEditorSaveControls");
  });

  it("uses one text-element editor and one DocStage edit behavior in formal and microcourse authoring", () => {
    const textEditor = read("src", "features", "courseware-doc", "CoursewareTextElementEditor.tsx");
    const elementEditor = read("src", "features", "courseware-doc", "CoursewarePageElementEditor.tsx");
    const stage = read("src", "features", "courseware-doc", "DocStage.tsx");
    const stageCss = read("src", "features", "courseware-doc", "doc-stage.css");
    const grid = read("src", "features", "courseware-doc", "CoursewareCompositionGridEditor.tsx");
    const formal = read("src", "features", "courseware-studio", "PageDocVerticalSliceEditor.tsx");
    const microcourse = read("src", "features", "teacher-microcourses", "CoursewareCompositionWorkbench.tsx");

    expect(textEditor).toContain("function CoursewareTextElementInspector");
    expect(textEditor).toContain("function CoursewareGridSnapToggle");
    expect(elementEditor).toContain("<CoursewareTextElementInspector");
    expect(formal).toContain("<CoursewarePageElementInspector");
    expect(microcourse).toContain("<CoursewarePageElementInspector");
    expect(formal).not.toContain("<CoursewareTextElementInspector");
    expect(microcourse).not.toContain("<CoursewareTextElementInspector");
    expect(formal).toContain("<CoursewareGridSnapToggle");
    expect(microcourse).toContain("<CoursewareGridSnapToggle");
    expect(formal.slice(formal.indexOf("const inspector ="))).not.toContain("<CoursewareGridSnapToggle");
    expect(microcourse.slice(microcourse.indexOf("const inspectorContent ="))).not.toContain("<CoursewareGridSnapToggle");
    expect(microcourse).not.toContain('t("gridComponentList")');
    expect(textEditor).not.toContain('t("textElement")');
    expect(stage).toContain("contentEditable={inlineTextEditing || undefined}");
    expect(stage).toContain('data-courseware-text-font-override');
    expect(stage).toContain('inlineTextFocused && !gesture ? "dashed" : "solid"');
    expect(stage).toContain("data-courseware-node-move-handle");
    expect(stage).toContain("data-courseware-node-resize-handle");
    expect(stage).toContain("data-courseware-node-snap-grid");
    expect(grid).toContain('filter((block) => block.type !== "node")');
    expect(grid).toContain("onNodeTextChange={onNodeTextChange}");
    expect(stageCss).toContain('[data-courseware-text-font-override="true"] *');
    expect(stageCss).toContain('[data-courseware-text-color-override="true"] *');
    expect(stageCss).toContain('[data-courseware-text-align-override="true"] *');
    expect(stageCss).toContain('[data-courseware-inline-text-editor="true"]');
    expect(formal).not.toContain("verticalSliceTextOrHtml");
    expect(microcourse).not.toContain("function NodeControls");
  });

  it("keeps the formal canvas header free of duplicated track titles", () => {
    const formal = read("src", "features", "courseware-studio", "UnifiedCoursewareWorkspace.tsx");
    expect(formal).not.toContain("toolbarTargetId?: string");
    expect(formal).not.toContain("{label}</span>");
    expect(formal).not.toMatch(/(?:toolbar|save|inspector).*TargetId/);
    expect(formal).not.toContain("CoursewareCapabilityPrototype");
    expect(formal).toContain("sourceReadOnlyToolbar");
  });

  it("reuses the mature preview workspace for read-only microcourse variants", () => {
    const variantPreview = read("src", "features", "teacher-microcourses", "MicrocourseVariantPreview.tsx");
    const sharedPreview = read("src", "features", "courseware-preview", "CoursewarePreviewWorkspace.tsx");

    expect(variantPreview).toContain("<CoursewareWorkbench");
    expect(variantPreview).toContain('mode="preview"');
    expect(variantPreview).toContain('layoutId="teacher-microcourse-variant-preview"');
    expect(variantPreview).not.toContain("<ScrollArea");
    expect(sharedPreview).toContain('<CoursewareWorkbench mode="preview"');
    const sharedWorkbench = read("src", "features", "courseware-doc", "CoursewareEditorWorkbench.tsx");
    expect(sharedWorkbench).toContain('window.addEventListener("keydown", onKeyDown, true)');
    expect(sharedWorkbench).toContain("event.stopPropagation()");
    expect(sharedWorkbench).toContain('aria-keyshortcuts="ArrowLeft PageUp"');
    expect(sharedWorkbench).toContain('aria-keyshortcuts="ArrowRight PageDown Space"');
  });

  it("shares the same aspect-correct stage viewport across all three modes", () => {
    const stage = read("src", "features", "courseware-doc", "CoursewareStageViewport.tsx");
    const adapterSurface = read("src", "features", "courseware-doc", "CoursewareEditorAdapterSurface.tsx");
    const preview = read("src", "features", "courseware-preview", "CoursewarePreviewWorkspace.tsx");
    const formal = read("src", "features", "courseware-studio", "FittedCoursewareCanvas.tsx");
    const microcourse = read("src", "features", "teacher-microcourses", "CoursewareCompositionWorkbench.tsx");

    expect(stage).toContain("availableHeight * aspect");
    expect(stage).toContain("ResizeObserver");
    expect(preview).toContain('<CoursewareWorkbench mode="preview"');
    const sharedWorkbench = read("src", "features", "courseware-doc", "CoursewareEditorWorkbench.tsx");
    expect(sharedWorkbench).toContain("<CoursewareStageViewport");
    expect(formal).toContain("<CoursewareStageViewport");
    expect(adapterSurface).toContain("<CoursewareStageViewport");
    expect(microcourse).toContain("<CoursewareEditorAdapterSurface");
    expect(microcourse).toContain("aspect={4 / 3}");
  });

  it("keeps insertion and save controls in the same shared topbar", () => {
    const shared = read("src", "features", "courseware-doc", "CoursewareEditorWorkbench.tsx");
    const formal = read("src", "features", "courseware-studio", "UnifiedCoursewareWorkspace.tsx");
    const pageDoc = read("src", "features", "courseware-studio", "PageDocVerticalSliceEditor.tsx");
    const microcourse = read("src", "features", "teacher-microcourses", "MicrocourseEditor.tsx");
    const composition = read("src", "features", "teacher-microcourses", "CoursewareCompositionWorkbench.tsx");
    const adapterSurface = read("src", "features", "courseware-doc", "CoursewareEditorAdapterSurface.tsx");

    expect(shared).toContain('data-courseware-editor-part="insert-toolbar"');
    expect(shared).toContain('data-courseware-editor-part="save-controls"');
    expect(formal).not.toMatch(/(?:toolbar|save|inspector).*TargetId/);
    expect(microcourse).not.toMatch(/(?:toolbar|save|inspector).*TARGET_ID/);
    expect(pageDoc).toContain("<CoursewareEditorAdapterSurface");
    expect(composition).toContain("<CoursewareEditorAdapterSurface");
    expect(adapterSurface).toContain("useCoursewareEditorChrome");
    expect(pageDoc).not.toContain("saveTargetId");
    expect(composition).not.toContain("saveTargetId");
    expect(composition).not.toContain("createPortal(saveControls");
  });

  it("keeps the formal workbench close to the panel bottom edge", () => {
    const formal = read("src", "features", "courseware-studio", "UnifiedCoursewareWorkspace.tsx");
    expect(formal).toContain("-mb-4");
    expect(formal).toContain("lg:-mb-5");
  });

  it("keeps persistence in adapters rather than the shared workbench", () => {
    const shared = read("src", "features", "courseware-doc", "CoursewareEditorWorkbench.tsx");
    const composition = read("src", "features", "teacher-microcourses", "CoursewareCompositionWorkbench.tsx");
    const pageDoc = read("src", "features", "courseware-studio", "PageDocVerticalSliceEditor.tsx");

    expect(shared).not.toContain("saveTeacherMicrocoursePageAction");
    expect(shared).not.toContain("fetch(");
    expect(composition).toContain("saveTeacherMicrocoursePageAction");
    expect(pageDoc).toContain("saveCoursewareDraftAction");
  });
});

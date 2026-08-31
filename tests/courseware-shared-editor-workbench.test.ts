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
    expect(shared).toContain('data-courseware-editor-slot="inspector-header"');
    expect(shared).toContain('data-courseware-editor-slot="inspector"');
    expect(formal).toContain('layout="workspace"');
    expect(microcourse).toContain('layout="viewport"');
    expect(shared).toContain('const adapt4x3 = mode === "formal-editor"');
    expect(shared).toContain("data-courseware-editor-adapt-4x3");
    expect(formal).toContain("adapter={selectedDoc?.docVersion");
    expect(microcourse).toContain('adapter="courseware-composition-v1"');
  });

  it("shares editor shell, insertion toolbar, canvas and inspector composition", () => {
    const shared = read("src", "features", "courseware-doc", "CoursewareEditorWorkbench.tsx");
    const composition = read("src", "features", "teacher-microcourses", "CoursewareCompositionWorkbench.tsx");
    const prototype = read("src", "features", "courseware-studio", "CoursewareCapabilityPrototype.tsx");

    for (const primitive of [
      "CoursewareEditorActionGrid",
      "CoursewareEditorToolbar",
      "CoursewareEditorToolbarButton",
      "CoursewareEditorToolbarLabel",
      "CoursewareInsertionToolbar",
      "CoursewareEditorSaveControls",
    ]) expect(shared).toContain(`function ${primitive}`);
    expect(composition).toContain("<CoursewareStageViewport");
    expect(composition).toContain("<CoursewareInsertionToolbar");
    expect(composition).toContain("<CoursewareEditorSaveControls");
    expect(composition).toContain("<CoursewareEditorToolbarButton");
    expect(prototype).toContain("<CoursewareEditorActionGrid");
    expect(prototype).toContain("<CoursewareInsertionToolbar");
    expect(read("src", "features", "courseware-studio", "PageDocVerticalSliceEditor.tsx")).toContain("<CoursewareEditorSaveControls");
  });

  it("keeps the formal canvas header free of duplicated track titles", () => {
    const formal = read("src", "features", "courseware-studio", "UnifiedCoursewareWorkspace.tsx");
    const prototype = read("src", "features", "courseware-studio", "CoursewareCapabilityPrototype.tsx");
    expect(formal).not.toContain("toolbarTargetId?: string");
    expect(formal).not.toContain("{label}</span>");
    expect(formal).toContain("toolbar={<div id={INSERT_TOOLBAR_TARGET_ID}");
    expect(prototype).not.toContain('className="justify-end"');
  });

  it("reuses the mature preview workspace for read-only microcourse variants", () => {
    const variantPreview = read("src", "features", "teacher-microcourses", "MicrocourseVariantPreview.tsx");
    const sharedPreview = read("src", "features", "courseware-preview", "CoursewarePreviewWorkspace.tsx");

    expect(variantPreview).toContain("<CoursewareWorkbench");
    expect(variantPreview).toContain('mode="preview"');
    expect(variantPreview).toContain('layoutId="teacher-microcourse-variant-preview"');
    expect(variantPreview).not.toContain("<ScrollArea");
    expect(sharedPreview).toContain('window.addEventListener("keydown", onKeyDown)');
    expect(sharedPreview).toContain('aria-keyshortcuts="ArrowLeft PageUp"');
    expect(sharedPreview).toContain('aria-keyshortcuts="ArrowRight PageDown Space"');
  });

  it("shares the same aspect-correct stage viewport across all three modes", () => {
    const stage = read("src", "features", "courseware-doc", "CoursewareStageViewport.tsx");
    const preview = read("src", "features", "courseware-preview", "CoursewarePreviewWorkspace.tsx");
    const formal = read("src", "features", "courseware-studio", "FittedCoursewareCanvas.tsx");
    const microcourse = read("src", "features", "teacher-microcourses", "CoursewareCompositionWorkbench.tsx");

    expect(stage).toContain("availableHeight * aspect");
    expect(stage).toContain("ResizeObserver");
    expect(preview).toContain("<CoursewareStageViewport");
    expect(formal).toContain("<CoursewareStageViewport");
    expect(microcourse).toContain("<CoursewareStageViewport");
    expect(microcourse).toContain("aspect={4 / 3}");
  });

  it("keeps the formal workbench close to the panel bottom edge", () => {
    const formal = read("src", "features", "courseware-studio", "UnifiedCoursewareWorkspace.tsx");
    expect(formal).toContain("-mb-4");
    expect(formal).toContain("lg:-mb-5");
  });

  it("keeps persistence in adapters rather than the shared workbench", () => {
    const shared = read("src", "features", "courseware-doc", "CoursewareEditorWorkbench.tsx");
    const composition = read("src", "features", "teacher-microcourses", "CoursewareCompositionWorkbench.tsx");
    const prototype = read("src", "features", "courseware-studio", "CoursewareCapabilityPrototype.tsx");

    expect(shared).not.toContain("saveTeacherMicrocoursePageAction");
    expect(shared).not.toContain("fetch(");
    expect(composition).toContain("saveTeacherMicrocoursePageAction");
    expect(prototype).toContain('data-persistence="none"');
  });
});

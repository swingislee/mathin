import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("shared courseware editor workbench", () => {
  it("uses one rounded Card workbench for formal courseware and teacher compositions", () => {
    const shared = read("src", "features", "courseware-doc", "CoursewareEditorWorkbench.tsx");
    const formal = read("src", "features", "courseware-studio", "UnifiedCoursewareWorkspace.tsx");
    const microcourse = read("src", "features", "teacher-microcourses", "MicrocourseEditor.tsx");

    expect(shared).toContain("data-courseware-editor-workbench");
    expect(shared).toContain("<Card");
    expect(formal).toContain("<CoursewareEditorWorkbench");
    expect(microcourse).toContain("<CoursewareEditorWorkbench");
    expect(shared).toContain("data-courseware-editor-adapter={adapter}");
    expect(formal).toContain("adapter={selectedDoc?.docVersion");
    expect(microcourse).toContain('adapter="courseware-composition-v1"');
  });

  it("shares editor shell, canvas, action-grid and top-toolbar primitives", () => {
    const shared = read("src", "features", "courseware-doc", "CoursewareEditorWorkbench.tsx");
    const composition = read("src", "features", "teacher-microcourses", "CoursewareCompositionWorkbench.tsx");
    const prototype = read("src", "features", "courseware-studio", "CoursewareCapabilityPrototype.tsx");

    for (const primitive of [
      "CoursewareEditorHeader",
      "CoursewareEditorBody",
      "CoursewareEditorCanvasFrame",
      "CoursewareEditorActionGrid",
      "CoursewareEditorToolbar",
      "CoursewareEditorToolbarButton",
      "CoursewareEditorToolbarLabel",
    ]) expect(shared).toContain(`function ${primitive}`);
    expect(composition).toContain("<CoursewareEditorHeader");
    expect(composition).toContain("<CoursewareEditorCanvasFrame");
    expect(composition).toContain("<CoursewareEditorToolbar");
    expect(composition).toContain("<CoursewareEditorToolbarButton");
    expect(prototype).toContain("<CoursewareEditorActionGrid");
    expect(prototype).toContain("<CoursewareEditorToolbar");
    expect(prototype).toContain("<CoursewareEditorToolbarButton");
  });

  it("reuses the mature preview workspace for read-only microcourse variants", () => {
    const variantPreview = read("src", "features", "teacher-microcourses", "MicrocourseVariantPreview.tsx");
    const sharedPreview = read("src", "features", "courseware-preview", "CoursewarePreviewWorkspace.tsx");

    expect(variantPreview).toContain("<CoursewarePreviewWorkspace");
    expect(variantPreview).toContain('layoutId="teacher-microcourse-variant-preview"');
    expect(variantPreview).not.toContain("<ScrollArea");
    expect(sharedPreview).toContain('window.addEventListener("keydown", onKeyDown)');
    expect(sharedPreview).toContain('aria-keyshortcuts="ArrowLeft PageUp"');
    expect(sharedPreview).toContain('aria-keyshortcuts="ArrowRight PageDown Space"');
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

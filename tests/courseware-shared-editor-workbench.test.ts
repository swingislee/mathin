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

  it("shares editor header, body, canvas frame and action-grid primitives", () => {
    const shared = read("src", "features", "courseware-doc", "CoursewareEditorWorkbench.tsx");
    const composition = read("src", "features", "teacher-microcourses", "CoursewareCompositionWorkbench.tsx");
    const prototype = read("src", "features", "courseware-studio", "CoursewareCapabilityPrototype.tsx");

    for (const primitive of [
      "CoursewareEditorHeader",
      "CoursewareEditorBody",
      "CoursewareEditorCanvasFrame",
      "CoursewareEditorActionGrid",
    ]) expect(shared).toContain(`function ${primitive}`);
    expect(composition).toContain("<CoursewareEditorHeader");
    expect(composition).toContain("<CoursewareEditorCanvasFrame");
    expect(composition).toContain("<CoursewareEditorActionGrid");
    expect(prototype).toContain("<CoursewareEditorActionGrid");
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

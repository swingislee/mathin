import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("courseware workbench mode unification", () => {
  const workbench = read("src/features/courseware-doc/CoursewareEditorWorkbench.tsx");
  const adapterSurface = read("src/features/courseware-doc/CoursewareEditorAdapterSurface.tsx");
  const previewWorkspace = read("src/features/courseware-preview/CoursewarePreviewWorkspace.tsx");
  const formalWorkspace = read("src/features/courseware-studio/UnifiedCoursewareWorkspace.tsx");
  const formalPrototype = read("src/features/courseware-studio/CoursewareCapabilityPrototype.tsx");
  const microcourseWorkspace = read("src/features/teacher-microcourses/MicrocourseEditor.tsx");

  it("keeps preview as a mode of the shared workbench instead of a reverse delegation", () => {
    expect(workbench).not.toContain("CoursewarePreviewWorkspace");
    expect(previewWorkspace).toContain('<CoursewareWorkbench mode="preview"');
    expect(workbench).toContain("function CoursewareWorkbenchFrame");
    expect(workbench).toContain('mode !== "preview"');
  });

  it("owns toolbar, save, fitted canvas, pager and inspector in one panel tree", () => {
    expect(workbench).toContain('data-courseware-editor-part="insert-toolbar"');
    expect(workbench).toContain('data-courseware-editor-part="save-controls"');
    expect(workbench).toContain('data-courseware-editor-part="canvas-footer"');
    expect(workbench).toContain('data-courseware-editor-slot="inspector"');
    expect(workbench).toContain("CoursewareStageViewport");
    expect(workbench).toContain("CoursewareWorkbenchPager");
    expect(workbench).toContain('const WORKBENCH_HEADER_ROW_CLASS = "h-11 min-h-11 max-h-11');
    expect(workbench.match(/WORKBENCH_HEADER_ROW_CLASS/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("registers editor controls through React context and cannot regress to DOM-id portals", () => {
    expect(adapterSurface).toContain("useCoursewareEditorChrome");
    expect(adapterSurface).not.toContain("createPortal");
    expect(adapterSurface).not.toContain("getElementById");
    expect(formalPrototype).toContain("useCoursewareEditorChrome({ toolbar: insertToolbar, saveControls, inspectorHeader })");
    expect(formalPrototype).toContain("<CoursewareEditorSaveControls");
    expect(formalWorkspace).not.toMatch(/(?:toolbar|save|inspector).*TargetId/);
    expect(microcourseWorkspace).not.toMatch(/(?:toolbar|save|inspector).*TARGET_ID/);
  });

  it("uses the shared pager in both editor products and limits 4:3 adaptation by mode", () => {
    expect(formalWorkspace).toContain("CoursewareWorkbenchPageRail");
    expect(microcourseWorkspace).toContain("CoursewareWorkbenchPageRail");
    expect(formalWorkspace).toContain("CoursewareWorkbenchPager");
    expect(microcourseWorkspace).toContain("CoursewareWorkbenchPager");
    expect(workbench).toContain('mode === "formal-editor" ? "enabled" : "disabled"');
  });
});

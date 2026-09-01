import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("courseware PageDoc formal editor", () => {
  it("loads supported PageDoc pages without a hidden sample query gate", () => {
    const loader = readFileSync("src/features/courseware-studio/unified-workspace-data.ts", "utf8");
    const workspace = readFileSync("src/features/courseware-studio/UnifiedCoursewareWorkspace.tsx", "utf8");

    expect(loader).toContain('requirePerm(locale, "courseware.page.edit")');
    expect(loader).toContain('loadCoursewareStudioPage(lectureId, pageDocId, "native-16x9")');
    expect(loader).toContain('loadCoursewareStudioPage(lectureId, pageDocId, "adapted-4x3")');
    expect(loader).toContain("fourByThreeDraft: adaptedPageDoc");
    expect(loader).toContain("...(nativePageDoc?.studioPage.bindingUrls ?? {})");
    expect(loader).not.toContain("PAGE_DOC_VERTICAL_SLICE_SAMPLE");
    expect(loader).not.toContain("rawSearchParams.edit");
    expect(workspace).not.toContain('query.set("edit", "page-doc")');
    expect(workspace).not.toContain("CoursewareCapabilityPrototype");
  });

  it("uses the existing draft revision action without exposing later-step writes", () => {
    const editor = readFileSync("src/features/courseware-studio/PageDocVerticalSliceEditor.tsx", "utf8");
    const stage = readFileSync("src/features/courseware-doc/DocStage.tsx", "utf8");
    const actions = readFileSync("src/features/courseware-studio/actions.ts", "utf8");

    expect(editor).toContain("saveCoursewareDraftAction");
    expect(editor).toContain('statusTestId="courseware-page-doc-autosave-status"');
    expect(editor).toContain("window.setTimeout(() => void flushRef.current(), 800)");
    expect(editor).toContain("playAutoInteractions={false}");
    expect(editor).toContain("useState<string | null>(null)");
    expect(editor).toContain("onNodeTransformChange={handleNodeTransformChange}");
    expect(editor).toContain("Object.assign(node.transform, patch)");
    expect(stage).toContain("else runtime.settleAuto()");
    expect(stage).toContain("data-courseware-node-resize-handle");
    expect(stage).toContain("onNodeTransformChange?.(node.nodePath, next)");
    expect(editor).toContain("data-content-changed");
    expect(editor).toContain("data-layout-changed");
    expect(editor).not.toContain("replaceCoursewarePageImageAction");
    expect(editor).not.toContain("publishCoursewareReleaseAction");
    expect(actions).toMatch(/authorizedClient\("courseware\.page\.edit"\)[\s\S]*save_cw_track_page_draft/);
    expect(actions).toContain('"RELATION_REQUIRED"');
  });
});

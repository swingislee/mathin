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

  it("shows the Step 5A replacement impact from the selected PageDoc resource without write controls", () => {
    const editor = readFileSync("src/features/courseware-studio/PageDocVerticalSliceEditor.tsx", "utf8");
    const preview = readFileSync("src/features/courseware-studio/asset-replacement/CoursewareAssetImpactPreview.tsx", "utf8");
    const actions = readFileSync("src/features/courseware-studio/actions.ts", "utf8");
    const actionStart = actions.indexOf("export async function previewCoursewareImageReplacementImpactAction");
    const actionEnd = actions.indexOf("const createSpatialPageSchema", actionStart);
    const readOnlyAction = actions.slice(actionStart, actionEnd);

    expect(editor).toContain("CoursewareAssetImpactPreview");
    expect(editor).toContain("selectedImageAsset");
    expect(preview).toContain("COURSEWARE_REPLACEMENT_IMPACT_SCOPES");
    expect(preview).toContain("CoursewareCompactChoiceGroup");
    expect(preview).toContain('className="min-h-0 min-w-0 flex-1"');
    expect(preview).toContain('className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-1 pr-2"');
    expect(preview).toContain('className="min-w-0 overflow-hidden rounded-lg border border-line/70');
    expect(preview).not.toContain("max-h-64");
    expect(preview).not.toContain("stageCoursewareImageReplacementAction");
    expect(preview).not.toContain("applyCoursewareImageReplacementAction");
    expect(preview).not.toContain('type="file"');
    expect(readOnlyAction).toContain("loadCoursewareSharedAssetDetail");
    expect(readOnlyAction).not.toContain("apply_cw_asset_replacement");
    expect(readOnlyAction).not.toContain("rollback_cw_asset_replacement");
  });

  it("keeps formal inspector metadata out of the editing rail and shares compact selectors", () => {
    const workspace = readFileSync("src/features/courseware-studio/UnifiedCoursewareWorkspace.tsx", "utf8");
    const editor = readFileSync("src/features/courseware-studio/PageDocVerticalSliceEditor.tsx", "utf8");
    const impact = readFileSync("src/features/courseware-studio/asset-replacement/CoursewareAssetImpactPreview.tsx", "utf8");
    const adaptation = readFileSync("src/features/courseware-studio/CoursewareFourByThreeAdapter.tsx", "utf8");

    expect(workspace).not.toContain("summary: <div");
    expect(editor).not.toContain("verticalSliceDraftRevision");
    expect(editor).toContain('value="replace" className="m-0 size-full min-h-0"');
    expect(impact).toContain("CoursewareCompactChoiceGroup");
    expect(adaptation).toContain("CoursewareCompactChoiceGroup");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("courseware PageDoc formal editor", () => {
  it("loads supported PageDoc pages without a hidden sample query gate", () => {
    const loader = readFileSync("src/features/courseware-studio/unified-workspace-data.ts", "utf8");
    const workspace = readFileSync("src/features/courseware-studio/UnifiedCoursewareWorkspace.tsx", "utf8");

    expect(loader).toContain('requirePerm(locale, "courseware.page.edit")');
    expect(loader).toContain('loadCoursewareStudioPage(lectureId, pageDocId, "native-16x9")');
    expect(loader).toContain('loadCoursewareStudioPage(lectureId, pageDocId, "adapted-4x3")');
    expect(loader).toContain("const fourByThreeBaseline = adaptedPageDoc ?? fourByThreeSource");
    expect(loader).toContain("doc: fourByThreeBaseline.doc");
    expect(loader).toContain("materialized: Boolean(editableAdaptedPage)");
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
    expect(editor).toContain("fourByThreeMaterializedRef.current");
    expect(editor).toContain('persistence="draft"');
    expect(editor).toContain("draftReady={fourByThreeMaterialized}");
    expect(editor).not.toContain("replaceCoursewarePageImageAction");
    expect(editor).not.toContain("publishCoursewareReleaseAction");
    expect(actions).toMatch(/authorizedClient\("courseware\.page\.edit"\)[\s\S]*save_cw_track_page_draft/);
    expect(actions).toContain('"RELATION_REQUIRED"');
  });

  it("atomically bootstraps a missing adapted PageDoc head and its track bindings", () => {
    const migration = readFileSync(
      "supabase/migrations/20260901000100_courseware_adapted_draft_bootstrap.sql",
      "utf8",
    );

    expect(migration).toContain("create or replace function public.save_cw_track_page_draft");
    expect(migration).toContain("page_version = 'page-doc-v1' and p_track = 'adapted-4x3'");
    expect(migration).toContain("p_page_doc_id, 'adapted-4x3', native_base_id");
    expect(migration).toContain("insert into public.cw_page_asset_bindings");
    expect(migration).toContain("on conflict (page_doc_id, binding_key, track) do nothing");
    expect(migration).toContain("save_cw_track_page_draft_pre_sml0_impl");
  });

  it("extends the accepted Step 5A impact model with one shared Step 5B replacement and rollback flow", () => {
    const editor = readFileSync("src/features/courseware-studio/PageDocVerticalSliceEditor.tsx", "utf8");
    const preview = readFileSync("src/features/courseware-studio/asset-replacement/CoursewareAssetImpactPreview.tsx", "utf8");
    const flow = readFileSync("src/features/courseware-studio/asset-replacement/useAssetReplacementFlow.ts", "utf8");
    const controls = readFileSync("src/features/courseware-studio/asset-replacement/AssetReplacementControls.tsx", "utf8");
    const controller = readFileSync("src/features/courseware-studio/asset-replacement/AssetReplacementController.tsx", "utf8");
    const rail = readFileSync("src/features/courseware-studio/asset-replacement/AssetReplacementRail.tsx", "utf8");
    const actions = readFileSync("src/features/courseware-studio/actions.ts", "utf8");
    const actionStart = actions.indexOf("export async function previewCoursewareImageReplacementImpactAction");
    const actionEnd = actions.indexOf("const createSpatialPageSchema", actionStart);
    const readOnlyAction = actions.slice(actionStart, actionEnd);

    expect(editor).toContain("CoursewareAssetImpactPreview");
    expect(editor).toContain("selectedImageAsset");
    expect(preview).toContain("COURSEWARE_REPLACEMENT_IMPACT_SCOPES");
    expect(preview).toContain("CoursewareCompactChoiceGroup");
    expect(preview).toContain("useAssetReplacementFlow");
    expect(preview).toContain("AssetReplacementControls");
    expect(preview).toContain("AssetReplacementHistory");
    expect(preview).toContain("AssetReplacementPreview");
    expect(preview).toContain('className="min-h-0 min-w-0 flex-1"');
    expect(preview).toContain('className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-3 pr-2"');
    expect(preview).toContain('className="min-w-0 overflow-hidden rounded-lg border border-line/70');
    expect(preview).toContain('className="shrink-0 px-3 py-1 text-xs leading-5 text-muted"');
    expect(preview).not.toContain('shrink-0 rounded-lg border border-line/80');
    expect(preview).not.toContain("max-h-64");
    expect(editor).toContain("previewBindingUrls");
    expect(editor).toContain("onStagedPreviewChange={setReplacementPreviewUrl}");
    expect(flow).toContain("stageCoursewareImageReplacementAction");
    expect(flow).toContain("applyCoursewareImageReplacementAction");
    expect(flow).toContain("rollbackCoursewareImageReplacementAction");
    expect(flow).toContain("selectedBindingIds");
    expect(flow).toContain("selectableIds(detail.usages)");
    expect(controls).toContain('type="file"');
    expect(controller).toContain("useAssetReplacementFlow");
    expect(rail).toContain("AssetReplacementControls");
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

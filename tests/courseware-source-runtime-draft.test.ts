import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  sourceRuntimeCourseware43Session,
  withSourceRuntimeCourseware43Session,
} from "@/features/courseware-doc/source-runtime-four-by-three";
import {
  sourceRuntimePageDocSchema,
  type SourceRuntimePageDoc,
} from "@/features/courseware-doc/source-runtime-schema";

const hash = (value: string) => value.repeat(64);

function fixture(): SourceRuntimePageDoc {
  return sourceRuntimePageDocSchema.parse({
    docVersion: "source-runtime-page-v1",
    source: {
      sourceSystem: "aixuexi_bsk",
      packageKey: "grade-1",
      coursewareId: "courseware-1",
      pageDatabaseId: 3,
      sourceSnapshotId: 7,
      sourceContentHash: hash("a"),
      pageName: "10的认识",
      groupName: "知识点1",
    },
    viewport: { width: 1200, height: 675 },
    runtime: {
      protocol: "mathin-source-runtime-v1",
      bindingKey: hash("b"),
      packageHash: hash("c"),
      entryPath: "index.html",
      sourceFingerprint: hash("d"),
    },
    payload: {
      format: "aixuexi-viewer-page-v1",
      data: { layout: { canvas: { width: 1200, height: 900 }, nodes: [] } },
    },
    bindings: { resources: {}, routes: [] },
    behavior: { advanceOnCanvasClick: false },
  });
}

describe("source-runtime formal draft persistence", () => {
  it("stores host 4:3 placement outside the producer layout", () => {
    const original = fixture();
    const adapted = withSourceRuntimeCourseware43Session(original, {
      strategy: "fit-width-center",
    });

    expect(sourceRuntimeCourseware43Session(original)).toBeNull();
    expect(sourceRuntimeCourseware43Session(adapted)).toEqual({
      strategy: "fit-width-center",
    });
    expect(adapted.payload.data.layout).toEqual(original.payload.data.layout);
    expect(adapted.source).toEqual(original.source);
    expect(adapted.runtime).toEqual(original.runtime);
    expect(adapted.bindings).toEqual(original.bindings);
  });

  it("loads draft heads and registers the same editor chrome used by PageDoc", () => {
    const loader = readFileSync("src/features/courseware-studio/unified-workspace-data.ts", "utf8");
    const route = readFileSync(
      "src/app/[locale]/dashboard/courseware/lectures/[lectureId]/page.tsx",
      "utf8",
    );
    const workspace = readFileSync("src/features/courseware-studio/UnifiedCoursewareWorkspace.tsx", "utf8");
    const editor = readFileSync("src/features/courseware-studio/SourceRuntimeFourByThreeEditor.tsx", "utf8");
    const actions = readFileSync("src/features/courseware-studio/actions.ts", "utf8");

    expect(loader).toContain("UnifiedSourceRuntimeEditorData");
    expect(loader).toContain("nativeStudioPage?.activeRevision.doc.docVersion === SOURCE_RUNTIME_PAGE_DOC_VERSION");
    expect(loader).toContain("adaptedStudioPage?.activeRevision.doc.docVersion === SOURCE_RUNTIME_PAGE_DOC_VERSION");
    expect(route).toContain("sourceRuntimeEditor={workspace.sourceRuntimeEditor}");
    expect(workspace).toContain("<SourceRuntimeFourByThreeEditor");
    expect(editor).toContain("<CoursewareEditorAdapterSurface");
    expect(editor).toContain("<CoursewarePageEditorToolbar");
    expect(editor).toContain("<CoursewareEditorSaveControls");
    expect(editor).toContain("saveCoursewareDraftAction");
    expect(editor).toContain('savingFourByThree ? "adapted-4x3" : track');
    expect(editor).toContain('statusTestId="courseware-source-runtime-autosave-status"');
    expect(actions).toContain("sourceRuntimePageDocSchema");
  });

  it("enforces the typed payload-only patch surface in the database", () => {
    const migration = readFileSync(
      "supabase/migrations/20260902000900_courseware_source_runtime_drafts.sql",
      "utf8",
    );

    expect(migration).toContain("public.cw_source_runtime_page_doc_is_valid");
    expect(migration).toContain("public.save_cw_source_runtime_page_draft");
    expect(migration).toContain("(p_candidate_doc - 'payload') is distinct from (p_base_doc - 'payload')");
    expect(migration).toContain("candidate_node ->> 'sourcePath' is distinct from base_node ->> 'sourcePath'");
    expect(migration).toContain("SOURCE_RUNTIME_DOCUMENT_IMMUTABLE");
    expect(migration).toContain("VERSION_CONFLICT");
    expect(migration).toContain("page_version in ('page-doc-v1', 'source-runtime-page-v1')");
    expect(migration).toContain("on conflict (page_doc_id, binding_key, track) do nothing");
    expect(migration).toContain("revoke all on function public.save_cw_source_runtime_page_draft");
    expect(migration).toContain("grant execute on function public.save_cw_track_page_draft");
  });
});

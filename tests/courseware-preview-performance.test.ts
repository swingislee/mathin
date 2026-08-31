import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("courseware preview page-turn performance", () => {
  it("keeps lecture page turns inside the preview and warms adjacent immutable pages", () => {
    const preview = read("src/features/school/curriculum/LectureCoursewarePreview.tsx");
    const action = read("src/features/courseware-preview/actions.ts");
    const data = read("src/features/courseware-studio/data.ts");
    const pageLoader = data.slice(
      data.indexOf("export async function loadLecturePreviewPage"),
      data.indexOf("async function materializeLecturePreviewPage"),
    );

    expect(preview).toContain("loadCoursewarePreviewPageAction");
    expect(preview).toContain("selectedIndex - 1, selectedIndex + 1");
    expect(preview).toContain("window.history.replaceState");
    expect(preview).toContain("new Map<string, Promise<CoursewarePreviewPagePayload>>");
    expect(preview).not.toContain("href: pageHrefs[index]");
    expect(action).toContain('authorizedClient("course.view")');
    expect(pageLoader).toContain('.from("cw_lecture_releases")');
    expect(data).toContain("scopeSourceRuntimeBindings(doc, snapshotEntry.bindings)");
    expect(data).toContain('bindingQuery.in("binding_key", [...requiredBindingKeys])');
    expect(pageLoader).not.toContain('.from("course_lectures")');
    expect(pageLoader).not.toContain('.from("cw_lecture_track_heads")');
  });

  it("reuses a source viewer iframe across pages from the same runtime package", () => {
    const stage = read("src/features/courseware-doc/SourceRuntimeStage.tsx");
    const dispatcher = read("src/features/courseware-studio/StagePreview.tsx");
    const sourceRuntimeBranch = dispatcher.slice(
      dispatcher.indexOf("if (isSourceRuntimePageDoc"),
      dispatcher.indexOf("if (isGamePageDoc"),
    );

    expect(stage).toContain('const runtimeInstanceKey = `${doc.runtime.packageHash}:${runtimeEntry ?? "missing"}`');
    expect(stage).toContain("key={runtimeInstanceKey}");
    expect(stage).toContain("runtimePayloadSentFor.current !== renderKey");
    expect(stage).toContain("hasRenderedCurrentRuntime");
    expect(stage).toContain("!rendered && !hasRenderedCurrentRuntime");
    expect(sourceRuntimeBranch).not.toContain("key=");
  });

  it("turns read-only Studio pages inside one cached client workspace", () => {
    const viewer = read("src/features/courseware-studio/AixuexiStudioViewer.tsx");
    const action = read("src/features/courseware-studio/preview-actions.ts");
    const data = read("src/features/courseware-studio/data.ts");
    const pageLoader = data.slice(
      data.indexOf("export async function loadCoursewareStudioRenderPage"),
      data.indexOf("async function loadImageAssetUsage"),
    );

    expect(viewer).toContain("loadCoursewareStudioRenderPageAction");
    expect(viewer).toContain("selectedIndex - 1, selectedIndex + 1");
    expect(viewer).toContain("window.history.replaceState");
    expect(viewer).toContain("new Map<string, Promise<CoursewareStudioRenderPagePayload>>");
    expect(viewer).toContain("renderedPageId !== selected.id");
    expect(action).toContain('authorizedClient("courseware.page.edit")');
    expect(pageLoader).toContain('.from("cw_page_revisions")');
    expect(pageLoader).toContain("resolveEditorBindingUrls");
    expect(pageLoader).not.toContain('.from("course_lectures")');
    expect(pageLoader).not.toContain('.from("cw_page_docs")');
    expect(pageLoader).not.toContain('.from("cw_page_track_heads")');
    expect(pageLoader).not.toContain("loadImageAssetUsage");
  });

  it("does not load native-editor support data for dedicated read-only renderers", () => {
    const data = read("src/features/courseware-studio/data.ts");
    const studioLoader = data.slice(
      data.indexOf("export async function loadCoursewareStudioPage"),
      data.indexOf("async function loadImageAssetUsage"),
    );
    const readOnlyBranch = studioLoader.slice(
      studioLoader.indexOf("if (activeRevision.doc.docVersion !== PAGE_DOC_VERSION)"),
      studioLoader.indexOf("const [", studioLoader.indexOf("if (activeRevision.doc.docVersion !== PAGE_DOC_VERSION)")),
    );

    expect(readOnlyBranch).toContain("resolveEditorBindingUrls");
    expect(readOnlyBranch).toContain("imageAssetUsage: {}");
    expect(readOnlyBranch).toContain("releaseHistory: []");
    expect(readOnlyBranch).toContain("copyTargets: []");
    expect(readOnlyBranch).not.toContain("loadImageAssetUsage");
    expect(readOnlyBranch).not.toContain('from("cw_lecture_releases")');
    expect(readOnlyBranch).not.toContain('from("course_lectures")');
  });

  it("resolves teacher-microcourse page bindings in shared batches", () => {
    const data = read("src/features/teacher-microcourses/data.ts");

    expect(data).toContain("resolvePageBindingUrls");
    expect(data).toContain("const bindings = pages.flatMap");
    expect(data).toContain("const bindingUrlsByPage = await resolvePageBindingUrls(normalizedPages)");
    expect(data).toContain("new Map(await Promise.all(h5Hashes.map");
    expect(data).not.toContain("bindingUrls: await resolveBindingUrls(bindings)");
  });
});

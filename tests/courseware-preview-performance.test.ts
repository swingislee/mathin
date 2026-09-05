import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("courseware preview page-turn performance", () => {
  it("keeps lecture page turns inside the preview and warms adjacent immutable pages", () => {
    const preview = read("src/features/school/curriculum/LectureCoursewarePreview.tsx");
    const route = read("src/app/api/courseware-preview/releases/[releaseId]/pages/[pageDocId]/route.ts");
    const client = read("src/features/courseware-preview/client.ts");
    const data = read("src/features/courseware-studio/data.ts");
    const pageLoader = data.slice(
      data.indexOf("export async function loadLecturePreviewPage"),
      data.indexOf("async function materializeLecturePreviewPage"),
    );

    expect(preview).toContain("fetchCoursewarePreviewPage");
    expect(preview).toContain("selectedIndex - 1, selectedIndex + 1, selectedIndex + 2, selectedIndex + 3");
    expect(preview).toContain("warmCoursewarePreviewPage");
    expect(preview).toContain("waitingForSelected");
    expect(preview).toContain("setRendered(payload)");
    expect(preview).toContain("cacheRef.current.get(pageDocId)");
    expect(preview).toContain("cacheRef.current.set(pageDocId, normalizedPayload)");
    expect(preview).not.toContain("const [cache, setCache]");
    expect(preview).toContain("selected.pageDocId === rendered.page.pageDocId");
    expect(preview).toContain("active && selectedPageIdRef.current === selected.pageDocId");
    expect(preview).toContain("window.history.replaceState");
    expect(preview).toContain("new Map<string, Promise<CoursewarePreviewPagePayload>>");
    expect(preview).not.toContain("href: pageHrefs[index]");
    expect(preview).toContain("preparedPageIdsRef.current.add(pageDocId)");
    expect(preview).toContain("reuseCoursewareObjectUrls");
    expect(route).toContain('authorizedClient("course.view")');
    expect(route).toContain('"Cache-Control": "private, no-store"');
    expect(client).toContain('cache: "no-store"');
    expect(client).toContain('credentials: "same-origin"');
    expect(pageLoader).toContain('.from("cw_lecture_releases")');
    expect(data).toContain("scopeCoursewareDocBindings(doc, snapshotEntry.bindings)");
    expect(data).toContain('bindingQuery.in("binding_key", [...requiredBindingKeys])');
    expect(pageLoader).not.toContain('.from("course_lectures")');
    expect(pageLoader).not.toContain('.from("cw_lecture_track_heads")');
  });

  it("lets presentation backgrounds bubble page clicks and prevents text selection", () => {
    const stage = read("src/features/courseware-doc/DocStage.tsx");
    const styles = read("src/features/courseware-doc/doc-stage.css");

    expect(stage).toContain("onClickCapture={onBackgroundSelect ? (event) => {");
    expect(stage).toContain("onBackgroundSelect();");
    expect(stage).toContain("} : undefined}");
    expect(styles).toContain("[data-doc-stage] {");
    expect(styles).toContain("user-select: none;");
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
    expect(stage).toContain("runtimeInFlightFor.current");
    expect(stage).toContain("runtimeQueuedRender.current");
    expect(stage).toContain("completedRenderKey");
    expect(stage).not.toContain("setRenderedFrameKey(renderKey)");
    expect(stage).toContain("hasRenderedCurrentRuntime");
    expect(stage).toContain("!rendered && !hasRenderedCurrentRuntime");
    expect(sourceRuntimeBranch).not.toContain("key=");
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

    expect(data).toContain("resolveTeacherMicrocoursePageBindingUrls");
    expect(data).toContain("const bindings = pages.flatMap");
    expect(data).toContain(
      "const bindingUrlsByPage = await resolveTeacherMicrocoursePageBindingUrls(normalizedPages)",
    );
    expect(data).toContain("new Map(await Promise.all(h5Hashes.map");
    expect(data).not.toContain("bindingUrls: await resolveBindingUrls(bindings)");
  });
});

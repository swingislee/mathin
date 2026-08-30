import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildPortableAixuexiViewerRuntime,
  portableAixuexiViewerHtml,
  stripInertMathTexScriptsForInspection,
} from "../scripts/lib/aixuexi-source-viewer-runtime.mjs";
import {
  collectSourceRuntimeBindingKeys,
  markSourceRuntimeNestedH5Url,
  sourceRuntimePageDocSchema,
  type SourceRuntimePageDoc,
} from "../src/features/courseware-doc/source-runtime-schema";
import {
  countCoursewareH5Frames,
  resolveClassroomRendererInputProfile,
} from "../src/features/classroom/input/capabilities";

const key = (character: string) => character.repeat(64);

function sourceRuntimeDoc(): SourceRuntimePageDoc {
  return sourceRuntimePageDocSchema.parse({
    docVersion: "source-runtime-page-v1",
    source: {
      sourceSystem: "aixuexi_bsk",
      packageKey: "2026-summer-aplus-quanguo-math",
      coursewareId: "1128889267",
      pageDatabaseId: 9,
      sourceSnapshotId: 9,
      sourceContentHash: key("a"),
      pageName: "妙答连连1",
      groupName: "一一对应",
    },
    viewport: { width: 1200, height: 675 },
    runtime: {
      protocol: "mathin-source-runtime-v1",
      bindingKey: key("b"),
      packageHash: key("c"),
      entryPath: "index.html",
      sourceFingerprint: key("d"),
    },
    payload: {
      format: "aixuexi-viewer-page-v1",
      data: {
        coursewareId: "1128889267",
        pageDatabaseId: 9,
        layout: { nodes: [] },
        topicInteraction: null,
        itvInteraction: null,
      },
    },
    bindings: {
      resources: { "28": key("e") },
      routes: [{
        path: "/api/aixuexi-topic/1128889267/9/launch-001/index.html",
        bindingKey: key("f"),
      }],
    },
    behavior: { advanceOnCanvasClick: false },
  });
}

describe("producer-owned Aixuexi source runtime", () => {
  it("shares one narrow MathJax-v2 inspection exception across build and import", () => {
    expect(stripInertMathTexScriptsForInspection(
      '<span><script type="math/tex">\\cdots</script></span>',
    )).toBe("<span></span>");
    expect(stripInertMathTexScriptsForInspection(
      '<script type="math/tex" src="evil.js"></script>',
    )).toContain("<script");
    expect(stripInertMathTexScriptsForInspection(
      '<script type="text/javascript">alert(1)</script>',
    )).toContain("<script");
  });

  it("keeps the runtime, resource and route bindings in one generic document contract", () => {
    const doc = sourceRuntimeDoc();
    expect([...collectSourceRuntimeBindingKeys(doc)]).toEqual([key("b"), key("e"), key("f")]);
    expect(sourceRuntimePageDocSchema.safeParse({
      ...doc,
      runtime: { ...doc.runtime, entryPath: "../index.html" },
    }).success).toBe(false);
    expect(sourceRuntimePageDocSchema.safeParse({
      ...doc,
      bindings: { ...doc.bindings, routes: [{ path: "//remote", bindingKey: key("f") }] },
    }).success).toBe(false);
  });

  it("marks nested H5 routes without losing existing query or fragment state", () => {
    expect(markSourceRuntimeNestedH5Url("/api/cw-h5/packages/a/index.html?mathin_h5_runtime=3#game"))
      .toBe("/api/cw-h5/packages/a/index.html?mathin_h5_runtime=3&mathin_source_runtime=mathin-source-runtime-v1#game");
  });

  it("treats the source runtime as one fail-closed classroom frame", () => {
    const doc = sourceRuntimeDoc();
    const page = { id: "source", type: "doc", docId: "source-doc", title: "Source" } as const;
    expect(countCoursewareH5Frames(doc)).toBe(1);
    expect(resolveClassroomRendererInputProfile(page, null, doc, "pending"))
      .toMatchObject({ audited: false, provisional: true });
    expect(resolveClassroomRendererInputProfile(page, null, doc, "ready"))
      .toMatchObject({ renderer: "document:source-runtime", audited: true, provisional: false });
    expect(resolveClassroomRendererInputProfile(page, null, doc, "incompatible"))
      .toMatchObject({ renderer: "unsupported", audited: false, provisional: false });
  });

  it("ports only the source Viewer's host seams and removes its review-site router", () => {
    const source = [
      "const PUBLIC_BASE_PATH='';",
      "const publicPath=path=>PUBLIC_BASE_PATH&&String(path).startsWith('/')&&path!==PUBLIC_BASE_PATH&&!String(path).startsWith(PUBLIC_BASE_PATH+'/')?PUBLIC_BASE_PATH+path:path;",
      "const assetUrl=(resource,page)=>publicPath('/api/assets/'+resource.resourceRefId+'/content?course='+encodeURIComponent(page.coursewareId)+'&page='+encodeURIComponent(page.pageDatabaseId));",
      "const assetPathPrefix=publicPath('/api/assets/');",
      "const isAixuexiLocalAssetUrl=value=>String(value).startsWith(assetPathPrefix);",
      "function safe(item,inlineImage,url,source){return !isAixuexiLocalAssetUrl(item.value)&&!inlineImage||!url.startsWith('#')&&!isAixuexiLocalAssetUrl(url)||!isAixuexiLocalAssetUrl(source)}",
      "function aixuexiPreviewHtml(){return '<div class=\"aix-layout-viewport\"></div>'}",
      "function fitAixuexiStages(){}",
      "async function hydrateAixuexiPreviews(){}",
      "function hydrateAixuexiPageBehaviors(){}",
      "function hydrateAixuexiMathAndItv(){}",
      "function scheduleAixuexiLayoutCorrections(){}",
      "function applyAixuexiLayoutCorrections(){}",
      "function aixuexiConsumesPageClick(){return false}",
      "route().catch(error=>console.error(error));",
    ].join("\n");
    const portable = buildPortableAixuexiViewerRuntime({
      viewerScript: source,
      viewerStyles: ".aix-shared-interaction-entry{background:#ffa51f}",
      staticRoutes: { "/api/runtime/source.js": "./source.js" },
    });
    expect(portable.viewerScript).toContain("MATHIN_PORTABLE");
    expect(portable.viewerScript).toContain("const isAixuexiLocalAssetUrl=value=>Object.values(MATHIN_PORTABLE?.resources||{})");
    expect(portable.viewerScript).not.toContain("assetPathPrefix");
    expect(portable.viewerScript).toContain("message.advanceOnCanvasClick===true");
    expect(portable.viewerScript).toContain("mathin-source-runtime-host");
    expect(portable.viewerScript).not.toContain("route().catch");
    expect(portable.sourceFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(portableAixuexiViewerHtml({ hasLottie: true })).toContain("viewer-runtime.js");
  });

  it("keeps Mathin as a sandbox host instead of recreating source buttons", () => {
    const host = readFileSync(
      new URL("../src/features/courseware-doc/SourceRuntimeStage.tsx", import.meta.url),
      "utf8",
    );
    expect(host).toContain("<iframe");
    expect(host).toContain("materializePayload");
    expect(host).toContain("renderedFrameKey === renderKey");
    expect(host).toContain("runtimeLoadedFor.current = runtimeInstanceKey");
    expect(host).toContain("runtimePayloadSentFor.current !== renderKey");
    expect(host).toContain("useLayoutEffect(() => {");
    expect(host).toContain('window.addEventListener("message", receive)');
    expect(host).toContain('key={runtimeInstanceKey}');
    expect(host).toContain('const renderKey = `${runtimeInstanceKey}:${doc.source.coursewareId}:${doc.source.pageDatabaseId}`');
    expect(host).not.toContain("setRendered(false)");
    expect(host).not.toContain("@/components/ui/button");
    expect(host).not.toContain("进入互动");
  });

  it("registers the generic adapter in the database without dropping legacy documents", () => {
    const migration = readFileSync(
      new URL("../supabase/migrations/20260827000500_courseware_source_runtime_adapter.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain("'aixuexi-page-v1', 'source-runtime-v1'");
    expect(migration).toContain("'source-runtime-page-v1'");
    expect(migration).toContain("cw_teacher_microcourse_source_revision_is_supported");
  });
});

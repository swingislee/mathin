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
  scopeSourceRuntimeBindings,
  sourceRuntimePageDocSchema,
  type SourceRuntimePageDoc,
} from "../src/features/courseware-doc/source-runtime-schema";
import {
  SOURCE_RUNTIME_DELIVERY_PARAM,
  SOURCE_RUNTIME_DELIVERY_VERSION,
  upgradeSourceRuntimeViewerScript,
  versionSourceRuntimeEntryUrl,
  versionSourceRuntimeHtmlAssets,
} from "../src/features/courseware-doc/source-runtime-delivery.mjs";
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

  it("resolves only bindings declared by the source document", () => {
    const doc = sourceRuntimeDoc();
    expect(scopeSourceRuntimeBindings(doc, [
      { bindingKey: key("a"), role: "obsolete-runtime" },
      { bindingKey: key("b"), role: "runtime" },
      { bindingKey: key("e"), role: "image" },
      { bindingKey: key("f"), role: "route" },
    ])).toEqual([
      { bindingKey: key("b"), role: "runtime" },
      { bindingKey: key("e"), role: "image" },
      { bindingKey: key("f"), role: "route" },
    ]);
  });

  it("fails closed when the snapshot misses a declared source binding", () => {
    const doc = sourceRuntimeDoc();
    expect(() => scopeSourceRuntimeBindings(doc, [
      { bindingKey: key("b") },
      { bindingKey: key("e") },
    ])).toThrow("SOURCE_RUNTIME_BINDING_MISSING");
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
    expect(portable.viewerScript).toContain("mathinQueuedRender");
    expect(portable.viewerScript).toContain("mathinRenderBody");
    expect(portable.viewerScript).toContain("document.startViewTransition");
    expect(portable.viewerScript).toContain("transition.ready.catch");
    expect(portable.viewerScript).toContain("transition.finished.catch");
    expect(portable.viewerScript).toContain("transition.updateCallbackDone");
    expect(portable.viewerScript).not.toContain("mathinWaitForVisualReady");
    expect(portable.viewerScript).not.toContain("mathinWarmRuntimeFonts");
    expect(portable.viewerScript).not.toContain("mathinRuntimeFontUrls");
    expect(portable.viewerScript).not.toContain("slide-runtime.css',location.href");
    expect(portable.viewerScript).toContain("renderKey:message.renderKey");
    expect(portable.viewerScript).not.toContain("route().catch");
    expect(portable.sourceFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(portableAixuexiViewerHtml({ hasLottie: true })).toContain("viewer-runtime.js");
  });

  it("upgrades published immutable source viewers through one versioned lifecycle seam", () => {
    const legacy = [
      "async function mathinRender(message){",
      "  app.replaceChildren();",
      "  mathinSend('rendered',{renderKey:message.renderKey});",
      "}",
      "async function mathinDrainRenderQueue(){return mathinRender({})}",
    ].join("\n");
    const upgraded = upgradeSourceRuntimeViewerScript(legacy);
    expect(upgraded).toContain("async function mathinRenderBody(message)");
    expect(upgraded).toContain("document.startViewTransition");
    expect(upgraded).toContain("transition.ready.catch");
    expect(upgraded).toContain("transition.finished.catch");
    expect(upgraded).not.toContain("document.fonts.ready");
    expect(upgraded).not.toContain("mathinWarmRuntimeFonts");
    expect(upgraded.indexOf("transition.updateCallbackDone"))
      .toBeLessThan(upgraded.indexOf("mathinSend('rendered'"));
    expect(upgradeSourceRuntimeViewerScript(upgraded)).toBe(upgraded);

    const priorDelivery = [
      "async function mathinRenderBody(message){app.replaceChildren(message)}",
      "const mathinVisualLifecycleVersion='3';",
      "function mathinWarmRuntimeFonts(){}",
      "async function mathinRender(message){mathinWarmRuntimeFonts()}",
      "async function mathinDrainRenderQueue(){return mathinRender({})}",
    ].join("\n");
    const refreshedDelivery = upgradeSourceRuntimeViewerScript(priorDelivery);
    expect(refreshedDelivery).toContain(`mathinVisualLifecycleVersion='${SOURCE_RUNTIME_DELIVERY_VERSION}'`);
    expect(refreshedDelivery).not.toContain("mathinWarmRuntimeFonts");

    const published = [
      "async function mathinRender(message){",
      "  app.replaceChildren();",
      "  mathinSend('rendered');",
      "}",
      "window.addEventListener('resize',()=>{})",
    ].join("\r\n");
    const upgradedPublished = upgradeSourceRuntimeViewerScript(published);
    expect(upgradedPublished).toContain("async function mathinRenderBody(message)");
    expect(upgradedPublished).toContain("renderKey:message.renderKey");
    expect(upgradedPublished).toContain("window.addEventListener('resize'");

    const entry = versionSourceRuntimeEntryUrl("/api/cw-h5/packages/hash/index.html?existing=1#slide");
    expect(entry).toContain(`${SOURCE_RUNTIME_DELIVERY_PARAM}=${SOURCE_RUNTIME_DELIVERY_VERSION}`);
    expect(entry.endsWith("#slide")).toBe(true);
    const html = versionSourceRuntimeHtmlAssets(
      '<script src="./viewer-runtime.js"></script>',
      `https://mathin.example/index.html?${SOURCE_RUNTIME_DELIVERY_PARAM}=${SOURCE_RUNTIME_DELIVERY_VERSION}`,
    );
    expect(html).toContain(`viewer-runtime.js?${SOURCE_RUNTIME_DELIVERY_PARAM}=${SOURCE_RUNTIME_DELIVERY_VERSION}`);
  });

  it("adapts the published 5.6.6 Lottie readiness bridge without replacing source rendering", () => {
    const published = [
      "async function hydrateAixuexiLottie(){",
      "    const animationData=await response.json();",
      "    let animation=null,settled=false,domReady=false,frameReady=false,finish=()=>{};",
      "    const ready=()=>{if(domReady&&frameReady){settle('playing')}};",
      "    animation=window.lottie.loadAnimation({",
      "        container:target,renderer:'svg',",
      "        path:source",
      "      });",
      "      animation.addEventListener('DOMLoaded',()=>{domReady=true;ready()});",
      "      animation.addEventListener('drawnFrame',()=>{frameReady=true;ready()});",
      "}",
      "const hydrateAixuexiPreviewsBase=hydrateAixuexiPreviews;",
      "async function mathinRender(message){",
      "  mathinSend('rendered',{renderKey:message.renderKey});",
      "}",
      "async function mathinDrainRenderQueue(){return mathinRender({})}",
    ].join("\n");

    const upgraded = upgradeSourceRuntimeViewerScript(published);
    expect(upgraded).toContain(`mathin-source-lottie-readiness-v${SOURCE_RUNTIME_DELIVERY_VERSION}`);
    expect(upgraded).toContain("animationData");
    expect(upgraded).not.toContain("path:source");
    expect(upgraded).toContain("DOMLoaded',()=>{domReady=true;frameReady=true;ready()}");
    expect(upgraded).not.toContain("addEventListener('drawnFrame'");
    expect(upgraded).toContain("window.lottie.loadAnimation");
    expect(upgraded).not.toContain("document.createElement");
    expect(upgradeSourceRuntimeViewerScript(upgraded)).toBe(upgraded);
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
    expect(host).toContain("runtimeInFlightFor.current");
    expect(host).toContain("runtimeQueuedRender.current");
    expect(host).toContain("completedRenderKey");
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

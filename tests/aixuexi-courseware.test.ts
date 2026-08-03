import { describe, expect, it } from "vitest";
import {
  aixuexiPageDocSchema,
  collectAixuexiBindingKeys,
  type AixuexiPageDoc,
} from "../src/features/courseware-doc/aixuexi-schema";
import { buildImportSql } from "../scripts/cw-import.mjs";
import { rewriteTopicRootUrls } from "../scripts/aixuexi-build-package.mjs";
import { renderAixuexiMathHtml } from "../src/features/courseware-doc/aixuexi-math";

const key = (character: string) => character.repeat(64);

function doc(): AixuexiPageDoc {
  return {
    docVersion: "aixuexi-page-doc-v1",
    adapter: "aixuexi-page-v1",
    projectionVersion: 5,
    source: {
      sourceSystem: "aixuexi_bsk",
      packageKey: "2026-gplus-sujiao-math",
      coursewareId: "1128947969",
      pageDatabaseId: 1,
      sourceSnapshotId: 1,
      sourceContentHash: key("a"),
      pageName: "首页",
      groupName: "模块",
    },
    canvas: {
      width: 1200,
      height: 675,
      sourceWidth: 1200,
      sourceHeight: 900,
      coordinateScaleY: 0.75,
      widgetOffsetX: 0,
      backgroundBindingKey: key("b"),
    },
    sourceKind: "slide_widgets",
    nodes: [{
      id: "background",
      sourcePath: "$.background",
      sourceType: "background",
      kind: "background",
      title: "页面背景",
      x: 0,
      y: 0,
      width: 1200,
      height: 675,
      zIndex: -1000,
      rotation: 0,
      known: true,
      html: null,
      resourceBindingKey: key("b"),
      resourceBindingKeys: [key("b")],
      warnings: [],
    }],
    topicInteraction: null,
    itvInteraction: null,
    behavior: { advanceOnCanvasClick: false },
    warnings: [],
  };
}

describe("Aixuexi courseware adapter", () => {
  it("freezes projection v5 separately from the E-series schema", () => {
    const parsed = aixuexiPageDocSchema.parse(doc());
    expect(parsed.docVersion).toBe("aixuexi-page-doc-v1");
    expect([...collectAixuexiBindingKeys(parsed)]).toEqual([key("b")]);
  });

  it("rewrites root runtime URLs relative to each offline topic file", () => {
    expect(rewriteTopicRootUrls('src="/remote/app.js"', "interactive/topic.html"))
      .toBe('src="../remote/app.js"');
    expect(rewriteTopicRootUrls('url(/remote/image.png)', "remote/site/assets/app.css"))
      .toBe("url(../../image.png)");
  });

  it("renders source math-tex spans to deterministic KaTeX markup", () => {
    const html = renderAixuexiMathHtml('<p>请计算 <span class="math-tex">\\(\\frac{2}{5}\\times\\frac{3}{4}\\)</span></p>');
    expect(html).toContain('data-math-rendered="true"');
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('>\\(\\frac{2}{5}');
  });

  it("adds source provenance plus native and top-aligned 4:3 releases to the import transaction", () => {
    const objectHash = key("c");
    const candidateKey = key("d");
    const bindingKey = key("b");
    const sql = buildImportSql({
      exportId: "aixuexi-fixture",
      lecture: {
        coursewareId: "1128947969",
        mathinProductCode: "AXX26G-SJ-03-AUT",
        lessonIndex: 1,
        lessonName: "混合运算",
        pageCount: 1,
        documentAdapter: "aixuexi-page-v1",
        sourceSystem: "aixuexi_bsk",
        sourcePackageKey: "2026-gplus-sujiao-math",
        sourcePackageManifestSha256: key("e"),
        sourcePackageLabels: { level: "G+" },
        sourcePackageScope: { term: "秋季" },
        sourcePackageCounts: { lectureCount: 52, pageCount: 1525 },
        sourceProductCode: "class-type-238353",
        offlineStatus: "complete",
        verificationSha256: key("f"),
      },
      pages: [{
        pageNo: 1,
        title: "首页",
        sourcePageId: "page-db:1",
        sourcePageDatabaseId: 1,
        doc: doc(),
        adaptClass: null,
        adaptReason: "",
        adaptReport: null,
      }],
      bindings: [{
        pageNo: 1,
        bindingKey,
        role: "background",
        kind: "image",
        candidateKey,
        launchQuery: null,
      }],
      objects: [{
        objectHash,
        mime: "image/png",
        byteCount: 1,
        kind: "image",
        storagePath: `sha256/${objectHash.slice(0, 2)}/${objectHash}`,
      }],
      assets: [{ candidateKey, kind: "image", role: "background", objectHash }],
      h5Manifests: new Map(),
    });

    expect(sql).toContain("cw_source_packages");
    expect(sql).toContain("cw_source_lectures");
    expect(sql).toContain("'native-16x9'");
    expect(sql).toContain("'adapted-4x3'");
    expect(sql).toContain("cw_import_inserted_adapted_release");
    expect(sql).toContain("adaptedReleaseInserted");
  });
});

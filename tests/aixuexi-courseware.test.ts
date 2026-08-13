import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  aixuexiPageDocSchema,
  aixuexiPackageLevel,
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
    projectionVersion: 31,
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
      height: 900,
      widgetOffsetX: 0,
      slideClass: "light-slide slide",
      backgroundBindingKey: key("b"),
    },
    playerStage: {
      width: 1920,
      height: 1080,
      presentationScale: 0.625,
      offsetX: 0,
      offsetY: 0,
      backgroundSize: "auto 1080px",
      backgroundPosition: "center center",
      backgroundRepeat: "no-repeat",
      backgroundColor: null,
      contentPadding: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    presentation: {
      width: 1200,
      height: 675,
      contentScale: 0.75,
      offsetX: 150,
      offsetY: 0,
    },
    sourceRuntime: {
      runtimeBindingKey: key("c"),
      slideStylesheetPath: "slide-runtime.css",
      itvStylesheetPath: "itv-runtime.css",
      lottieRuntimePath: null,
      lottieRuntimeSha256: null,
      questionImageSizing: null,
      questionImageSizingInput: { imgs: {} },
    },
    behaviors: {
      splitQuestionScroll: null,
      singleQuestionScroll: null,
      stagedReveal: { underlineCount: 0, summaryWidgetCount: 0 },
      widgetReveal: { steps: 0 },
      shapeTextFit: null,
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
      height: 900,
      zIndex: -1000,
      rotation: 0,
      transform: "",
      transformOrigin: "",
      known: true,
      html: null,
      resourceBindingKey: key("b"),
      resourceBindingKeys: [key("b")],
      revealStep: 0,
      animations: [],
      questionTkRuntime: null,
      embeddedH5: null,
      trueOrFalse: null,
      topicClassification: null,
      warnings: [],
    }],
    topicInteraction: null,
    itvInteraction: null,
    behavior: { advanceOnCanvasClick: false },
    fourByThree: { mode: "source-master", reasons: [] },
    warnings: [],
  };
}

describe("Aixuexi courseware adapter", () => {
  it("derives the displayed level from every supported package key", () => {
    expect(aixuexiPackageLevel("2026-gplus-sujiao-math")).toBe("G+");
    expect(aixuexiPackageLevel("2026-xplus-sujiao-math")).toBe("X+");
    expect(aixuexiPackageLevel("2026-aplus-quanguo-math")).toBe("A+");
    expect(aixuexiPackageLevel("future-package")).toBeNull();
  });

  it("freezes projection v31 separately from the E-series schema", () => {
    const parsed = aixuexiPageDocSchema.parse(doc());
    expect(parsed.docVersion).toBe("aixuexi-page-doc-v1");
    expect([...collectAixuexiBindingKeys(parsed)]).toEqual([key("b"), key("c")]);
  });

  it("keeps the 4:3 master canvas unscaled and carries the source 16:9 presentation rule", () => {
    const parsed = aixuexiPageDocSchema.parse(doc());
    // 母版就是 4:3；16:9 是源播放器 contain 出来的画框，不是内容的原始比例。
    expect(parsed.canvas.width / parsed.canvas.height).toBeCloseTo(4 / 3, 10);
    expect(parsed.presentation.width / parsed.presentation.height).toBeCloseTo(16 / 9, 10);
    expect(parsed.presentation.contentScale)
      .toBeCloseTo(parsed.presentation.height / parsed.canvas.height, 10);
    expect(parsed.presentation.offsetX)
      .toBeCloseTo((parsed.presentation.width - parsed.canvas.width * parsed.presentation.contentScale) / 2, 10);
  });

  it("rejects a doc that squashes the master into the 16:9 frame", () => {
    const squashed = { ...doc(), canvas: { ...doc().canvas, height: 675 } };
    expect(aixuexiPageDocSchema.safeParse(squashed).success).toBe(false);
  });

  it("carries an uncaptured topic interaction as a null-binding gap", () => {
    const parsed = aixuexiPageDocSchema.parse({
      ...doc(),
      topicInteraction: {
        status: "capture_required",
        topicId: "7392129",
        entryKind: "quick_wit_answer",
        bindingKey: null,
      },
    });
    expect(parsed.topicInteraction?.status).toBe("capture_required");
    expect([...collectAixuexiBindingKeys(parsed)]).toEqual([key("b"), key("c")]);
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

const contractRoot = process.env.AIXUEXI_CONTRACT_ROOT;

describe.skipIf(!contractRoot)("Aixuexi generated v31 packages", () => {
  it("parses every page and reconciles every document binding with usages.ndjson", () => {
    let pageCount = 0;
    let compatibilityCount = 0;
    for (const directory of readdirSync(contractRoot!, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      const packageRoot = path.join(contractRoot!, directory.name);
      const usages = new Set(
        readFileSync(path.join(packageRoot, "usages.ndjson"), "utf8")
          .trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line).usageKey as string),
      );
      for (const file of readdirSync(path.join(packageRoot, "page-docs"))) {
        const rows = readFileSync(path.join(packageRoot, "page-docs", file), "utf8")
          .trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { pageIndex: number; doc: unknown });
        for (const row of rows) {
          const parsed = aixuexiPageDocSchema.parse(row.doc);
          for (const binding of collectAixuexiBindingKeys(parsed)) {
            expect(usages.has(binding), `${directory.name}/${file}/${row.pageIndex}/${binding}`).toBe(true);
          }
          pageCount += 1;
          if (parsed.fourByThree.mode === "source-player-compat") compatibilityCount += 1;
        }
      }
    }
    expect(pageCount).toBe(5442);
    expect(compatibilityCount).toBe(422);
  });
});

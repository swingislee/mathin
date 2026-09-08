import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { createEmptyCoursewareCompositionPage } from "../src/features/courseware-doc/composition-page-schema";
import type { CoursewareDoc } from "../src/features/courseware-doc/document";
import type { SourceRuntimePageDoc } from "../src/features/courseware-doc/source-runtime-schema";
import type { SessionPageDoc } from "../src/features/classroom/courseware/session-assets";
import type { CoursewarePage } from "../src/features/classroom/types";
import {
  classroomDocMountKey,
  classroomWarmImageUrls,
  createClassroomImageWarmup,
} from "../src/features/classroom/live/classroom-page-presentation";

const hash = (value: string) => value.repeat(64);
const imageKey = (page: number) => page.toString(16).padStart(64, "0");
function sourceDoc(page: number): SourceRuntimePageDoc {
  return {
    docVersion: "source-runtime-page-v1",
    source: { sourceSystem: "aixuexi", packageKey: "fixture", coursewareId: "1", pageDatabaseId: page + 1, sourceSnapshotId: 1, sourceContentHash: hash("a"), pageName: `Page ${page}`, groupName: null },
    runtime: { protocol: "mathin-source-runtime-v1", packageHash: hash("b"), bindingKey: hash("c"), entryPath: "index.html", sourceFingerprint: hash("d") },
    viewport: { width: 1200, height: 675 },
    payload: { format: "aixuexi-viewer-page-v1", data: { assets: { resources: [{ resourceRefId: 1, kind: "image" }] } } },
    bindings: { resources: { "1": imageKey(page) }, routes: [] },
    behavior: { advanceOnCanvasClick: false },
  };
}

// 检查正式课堂最外层实际使用的 key，覆盖之前只检查 StagePreview 内层而漏掉的重建。
const liveShell = ts.createSourceFile("LiveShell.tsx", readFileSync(
  new URL("../src/features/classroom/live/LiveShell.tsx", import.meta.url), "utf8",
), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function mountKey(component: string, pageId: string, doc?: CoursewareDoc) {
  let expression: string | undefined;
  let docKeyExpression: string | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(liveShell) === "docMountKey") {
      docKeyExpression = node.initializer?.getText(liveShell);
    }
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(liveShell) === component) {
      const key = node.attributes.properties.find((attr) => ts.isJsxAttribute(attr) && attr.name.getText(liveShell) === "key");
      if (key && ts.isJsxAttribute(key) && key.initializer && ts.isJsxExpression(key.initializer)) {
        expression = key.initializer.expression?.getText(liveShell);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(liveShell);
  expect(expression, `${component} mount key`).toBeDefined();
  return new Function("renderPage", "renderDoc", "classroomDocMountKey", "usingM3Fixture", "m3FixtureRenderer", "m3H5Compatible", `const docMountKey = ${docKeyExpression}; return (${expression});`)(
    { id: pageId }, doc, classroomDocMountKey, false, "mofaxiao", true,
  );
}

describe("formal classroom page presentation", () => {
  it("retains the whole source runtime across adjacent pages and return visits", () => {
    const first = mountKey("DocCoursewarePage", "session-page-1", sourceDoc(1));
    expect(mountKey("DocCoursewarePage", "session-page-2", sourceDoc(2))).toBe(first);
    expect(mountKey("DocCoursewarePage", "session-page-1", sourceDoc(1))).toBe(first);
    const otherPackage = sourceDoc(2);
    otherPackage.runtime.packageHash = hash("e");
    expect(mountKey("DocCoursewarePage", "session-page-2", otherPackage)).not.toBe(first);
    const otherEntry = sourceDoc(2);
    otherEntry.runtime.entryPath = "other/index.html";
    expect(mountKey("DocCoursewarePage", "session-page-2", otherEntry)).not.toBe(first);
  });

  it("keeps native interactions, composition games, and whiteboards isolated per page", () => {
    const composition = createEmptyCoursewareCompositionPage();
    for (const doc of [composition, composition.overlay]) {
      expect(mountKey("DocCoursewarePage", "page-1", doc)).not.toBe(mountKey("DocCoursewarePage", "page-2", doc));
      expect(mountKey("DocCoursewarePage", "page-1", doc)).not.toBe(mountKey("DocCoursewarePage", "page-1", sourceDoc(1)));
    }
    expect(mountKey("GamePage", "page-1")).not.toBe(mountKey("GamePage", "page-2"));
    expect(mountKey("MainBoard", "page-1")).not.toBe(mountKey("MainBoard", "page-2"));
  });

  it("warms images in classroom order despite shuffled docs, sharing URLs and missing assets", () => {
    const pages: CoursewarePage[] = Array.from({ length: 8 }, (_, index) => ({ id: `page-${index}`, docId: `doc-${index}`, title: "", type: "doc" }));
    const docs: SessionPageDoc[] = pages.map((_, index) => ({ pageDocId: `doc-${index}`, pageNo: index, doc: sourceDoc(index), bindings: [] })).reverse();
    const urls = Object.fromEntries(pages.map((_, index) => [imageKey(index), `blob:image-${index}`]));
    expect(classroomWarmImageUrls(pages, 3, docs, urls, {})).toEqual([
      "blob:image-3", "blob:image-4", "blob:image-5", "blob:image-6", "blob:image-2",
    ]);
    urls[imageKey(5)] = urls[imageKey(4)];
    delete urls[imageKey(6)];
    expect(classroomWarmImageUrls(pages, 3, docs, urls, {})).toEqual(["blob:image-3", "blob:image-4", "blob:image-2"]);
    expect(classroomWarmImageUrls(pages, 0, null, {}, {})).toEqual([]);
  });

  it("includes composition overlays and legacy images while leaving video and H5 downloads to the asset loader", () => {
    const composition = createEmptyCoursewareCompositionPage();
    composition.overlay.canvas.backgroundBindingKey = hash("a");
    const pages: CoursewarePage[] = [
      { id: "image", type: "image", path: "image.png", title: "" },
      { id: "video", type: "video", path: "video.mp4", title: "" },
      { id: "doc", type: "doc", docId: "composition", title: "" },
    ];
    expect(classroomWarmImageUrls(pages, 0, [{ pageDocId: "composition", pageNo: 1, doc: composition, bindings: [] }], {
      [hash("a")]: "blob:overlay", unusedH5: "/api/cw-h5/index.html",
    }, { "image.png": "blob:legacy", "video.mp4": "blob:video" })).toEqual(["blob:legacy", "blob:overlay"]);
  });
});

const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
describe("bounded classroom image warming", () => {
  it("keeps two decode slots and replaces queued old pages after a jump without duplicating in-flight images", async () => {
    const finish = new Map<string, () => void>();
    const warm = vi.fn((url: string) => new Promise<void>((resolve) => finish.set(url, resolve)));
    const queue = createClassroomImageWarmup(warm);
    queue.update(["a", "a", "b", "old"]);
    await settle();
    expect(warm.mock.calls.flat()).toEqual(["a", "b"]);
    queue.update(["a", "b", "next"]);
    finish.get("a")!();
    await settle();
    expect(warm.mock.calls.flat()).toEqual(["a", "b", "next"]);
    finish.get("b")!();
    finish.get("next")!();
    await settle();
    queue.update(["a", "b", "next"]);
    await settle();
    expect(warm).toHaveBeenCalledTimes(3);
    queue.dispose();
  });

  it("continues after decoding fails and stops scheduling when the classroom unmounts", async () => {
    const warm = vi.fn().mockRejectedValue(new Error("decode failed"));
    const queue = createClassroomImageWarmup(warm);
    queue.update(["a", "b", "c"]);
    await settle();
    expect(warm.mock.calls.flat()).toEqual(["a", "b", "c"]);
    queue.dispose();
    queue.update(["d"]);
    await settle();
    expect(warm).toHaveBeenCalledTimes(3);
  });
});

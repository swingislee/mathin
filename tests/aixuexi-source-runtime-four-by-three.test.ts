import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  sourceRuntimeFourByThreeMode,
} from "../src/features/courseware-doc/source-runtime-four-by-three";
import {
  sourceRuntimePageDocSchema,
  type SourceRuntimePageDoc,
} from "../src/features/courseware-doc/source-runtime-schema";

const key = (character: string) => character.repeat(64);

function sourceRuntimeDoc(
  layout: Record<string, unknown>,
  format = "aixuexi-viewer-page-v1",
): SourceRuntimePageDoc {
  return sourceRuntimePageDocSchema.parse({
    docVersion: "source-runtime-page-v1",
    source: {
      sourceSystem: "aixuexi_bsk",
      packageKey: "audit-package",
      coursewareId: "1128889267",
      pageDatabaseId: 29,
      sourceSnapshotId: 29,
      sourceContentHash: key("a"),
      pageName: "4:3 audit",
      groupName: null,
    },
    viewport: { width: 1200, height: 675 },
    runtime: {
      protocol: "mathin-source-runtime-v1",
      bindingKey: key("b"),
      packageHash: key("c"),
      entryPath: "index.html",
      sourceFingerprint: key("d"),
    },
    payload: { format, data: { layout } },
    bindings: { resources: {}, routes: [] },
    behavior: { advanceOnCanvasClick: false },
  });
}

describe("Aixuexi source-runtime 4:3 projection", () => {
  it("restores a 1200×900 source master as a direct 4:3 page", () => {
    const doc = sourceRuntimeDoc({ canvas: { width: 1200, height: 900 }, nodes: [] });
    expect(sourceRuntimeFourByThreeMode(doc)).toBe("source-master");
  });

  it.each([
    ["source animation", { canvas: { width: 1200, height: 900 }, nodes: [{ animations: [{}] }] }],
    ["embedded H5", { canvas: { width: 1200, height: 900 }, nodes: [{ embeddedH5: {} }] }],
    ["native game", { canvas: { width: 1200, height: 900 }, nodes: [{ trueOrFalse: {} }] }],
    ["topic interaction", { canvas: { width: 1200, height: 900 }, nodes: [{ topicClassification: {} }] }],
    ["wide canvas", { canvas: { width: 1920, height: 1080 }, nodes: [] }],
  ])("keeps %s on the top-aligned player-compat path", (_label, layout) => {
    expect(sourceRuntimeFourByThreeMode(sourceRuntimeDoc(layout)))
      .toBe("source-player-compat");
  });

  it("fails closed for unknown or incomplete producer payloads", () => {
    expect(sourceRuntimeFourByThreeMode(sourceRuntimeDoc({}, "unknown-viewer-v1")))
      .toBe("source-player-compat");
    expect(sourceRuntimeFourByThreeMode(sourceRuntimeDoc({ nodes: [] })))
      .toBe("source-player-compat");
  });

  it("uses aspect-preserving source-master geometry only in board43 mode", () => {
    const stage = readFileSync(
      new URL("../src/features/courseware-doc/SourceRuntimeStage.tsx", import.meta.url),
      "utf8",
    );
    expect(stage).toContain("sourceRuntimeFourByThreeMode(doc)");
    expect(stage).toContain('fourByThreeMode === "source-master"');
    expect(stage).toContain("(sourceAspect / outerAspect) * 100");
    expect(stage).toContain("data-four-by-three-mode");
  });
});

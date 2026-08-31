import { describe, expect, it } from "vitest";

import {
  collectCoursewareDocBindingKeys,
  scopeCoursewareDocBindings,
} from "../src/features/courseware-doc/document";
import type { PageDoc } from "../src/features/courseware-doc/schema";
import { collectCoursewarePreviewWarmTargets } from "../src/features/courseware-preview/preload";

const key = (character: string) => character.repeat(64);

function doc(): PageDoc {
  return {
    docVersion: "page-doc-v1",
    sourceCoursewareId: "mofaxiao-fixture",
    sourcePageId: "page:1",
    sourcePageDatabaseId: 1,
    sourceSnapshotId: 1,
    sourceContentHash: key("a"),
    canvas: {
      width: 1280,
      height: 720,
      backgroundColor: null,
      backgroundBindingKey: key("b"),
    },
    nodes: [{
      id: "image",
      nodePath: "$.nodes[0]",
      sourceType: "img",
      sourceResourceId: "1",
      adapter: "image",
      name: "image",
      supported: true,
      visible: true,
      interactive: false,
      zIndex: 1,
      order: 1,
      crop: null,
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0, opacity: 1, flipX: false, flipY: false, clip: false },
      style: { objectFit: "contain", backgroundColor: null, color: null, borderColor: null, borderWidth: 0, borderRadius: 0, fontFamily: null, fontSize: null, fontWeight: null, lineHeight: null, letterSpacing: null, whiteSpace: null, textAlign: null, overflow: "visible" },
      content: { kind: "text", text: "fixture" },
      resources: [
        { bindingKey: key("c"), bindingPath: "$.src", role: "source", kind: "image" },
        { bindingKey: key("d"), bindingPath: "$.entry", role: "entry", kind: "h5" },
      ],
      children: [],
    }],
    interactions: [],
  };
}

describe("mofaxiao preview binding closure and warming", () => {
  it("excludes historical thumbnail bindings from render materialization", () => {
    const page = doc();
    expect([...collectCoursewareDocBindingKeys(page)!]).toEqual([key("b"), key("c"), key("d")]);
    expect(scopeCoursewareDocBindings(page, [
      { bindingKey: key("b"), role: "background" },
      { bindingKey: key("c"), role: "source" },
      { bindingKey: key("d"), role: "entry" },
      { bindingKey: key("e"), role: "page_thumbnail" },
    ])).toEqual([
      { bindingKey: key("b"), role: "background" },
      { bindingKey: key("c"), role: "source" },
      { bindingKey: key("d"), role: "entry" },
    ]);
  });

  it("warms only declared image and H5 URLs", () => {
    expect(collectCoursewarePreviewWarmTargets(doc(), {
      [key("b")]: "https://assets/background.png",
      [key("c")]: "https://assets/image.png",
      [key("d")]: "/api/cw-h5/packages/runtime/index.html",
      [key("e")]: "https://assets/thumbnail.png",
    })).toEqual([
      { kind: "image", url: "https://assets/background.png" },
      { kind: "image", url: "https://assets/image.png" },
      { kind: "h5", url: "/api/cw-h5/packages/runtime/index.html" },
    ]);
  });
});

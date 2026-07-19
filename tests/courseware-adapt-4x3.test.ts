import { describe, expect, it } from "vitest";
import { derive43PageDoc } from "@/features/courseware-doc/adapt-4x3";
import { pageDocSchema } from "@/features/courseware-doc/schema";

const hash = "a".repeat(64);
const doc = pageDocSchema.parse({
  docVersion: "page-doc-v1", sourceCoursewareId: "cw", sourcePageId: "page", sourcePageDatabaseId: 1, sourceSnapshotId: 1, sourceContentHash: hash,
  canvas: { width: 1280, height: 720, backgroundColor: null, backgroundBindingKey: null },
  nodes: [{ id: "n", nodePath: "$.children[0]", sourceType: "img", sourceResourceId: null, adapter: "image", name: null, supported: true, visible: true, interactive: false, zIndex: 0, order: 0, crop: null,
    transform: { x: 100, y: 20, width: 400, height: 200, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0, opacity: 1, flipX: false, flipY: false, clip: false },
    style: { objectFit: "contain", backgroundColor: null, color: null, borderColor: null, borderWidth: 0, borderRadius: 0, fontFamily: null, fontSize: null, fontWeight: null, lineHeight: null, letterSpacing: null, whiteSpace: null, textAlign: null, overflow: "visible" }, content: null, resources: [], children: [] }],
  interactions: [{ trigger: "auto", triggerScope: "auto", triggerResourceId: null, targetResourceId: "n", action: "path", animation: "none", delay: 0, duration: 1, loop: 0, path: { type: "line", points: [100, 20, 500, 220] }, audioBindingKey: null, audioName: null, step: 0 }],
});

describe("derive43PageDoc", () => {
  it("applies one affine to nodes and path points", () => {
    const derived = derive43PageDoc(doc, { scale: 0.75, translateX: 10, translateY: 0 });
    expect(derived.canvas).toMatchObject({ width: 960, height: 720 });
    expect(derived.nodes[0]?.transform).toMatchObject({ x: 85, width: 300, height: 150 });
    expect(derived.interactions[0]?.path?.points).toEqual([85, 15, 385, 165]);
  });

  it("supports an axis-specific H5 transform for nodes and path points", () => {
    const derived = derive43PageDoc(doc, { scaleX: 0.75, scaleY: 1, translateX: 0, translateY: 0 });
    expect(derived.nodes[0]?.transform).toMatchObject({ x: 75, y: 20, width: 300, height: 200 });
    expect(derived.interactions[0]?.path?.points).toEqual([75, 20, 375, 220]);
  });

  it("keeps centre-title nodes unchanged inside a 16:9-scale content frame", () => {
    const originalGroup = { ...doc.nodes[0]!, adapter: "group" as const, transform: { ...doc.nodes[0]!.transform, x: 0, y: 275, width: 1280, height: 170 }, children: [doc.nodes[0]!] };
    const derived = derive43PageDoc({ ...doc, nodes: [originalGroup] }, { scale: 1, translateX: 0, translateY: 0 }, "frame");
    expect(derived.nodes[0]?.transform).toMatchObject({ x: 0, y: 90, width: 1280, height: 720, scaleX: 0.75, scaleY: 0.75 });
    expect(derived.nodes[0]?.children[0]?.transform).toMatchObject({ x: 0, y: 275, width: 1280, height: 170 });
    expect(derived.nodes[0]?.children[0]?.children[0]?.transform).toMatchObject({ x: 100, y: 20, width: 400, height: 200 });
    expect(derived.interactions[0]?.path?.points).toEqual([100, 20, 500, 220]);
  });
});

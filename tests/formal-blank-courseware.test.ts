import { describe, expect, it } from "vitest";
import { createEmptyCoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";
import { addCoursewareCompositionNode, addCoursewareCompositionTool } from "@/features/courseware-doc/composition-page-layout";
import { createCoursewareInsertedImageNode, createCoursewareInsertedH5Node, createCoursewareInsertedNode } from "@/features/courseware-doc/courseware-inserted-node";
import { formalManualPageSchema } from "@/features/courseware-studio/formal-manual-page-contract";
import { createCubeCoursewareTool } from "@/features/tools/courseware/cube-structures-content";
import { cubeDraftSnapshot } from "@/features/tools/spatial-lab/cube-structures-draft";
import { createCubeSession } from "@/features/tools/spatial-lab/cube-structures-session";
import { parseCoursewareDoc } from "@/features/courseware-doc/document";

describe("generic formal blank composition", () => {
  it("uses the existing empty document and supports a subsequently inserted fixed cube", () => {
    const blank = createEmptyCoursewareCompositionPage();
    expect(formalManualPageSchema.parse(blank).layout.blocks).toEqual([]);
    expect(blank.overlay.nodes).toEqual([]);
    const tool = createCubeCoursewareTool({ name: "Cube", snapshot: cubeDraftSnapshot(createCubeSession([{ x: 0, y: 0, z: 0 }]), 0) }, "current", ["orbit"]);
    const page = addCoursewareCompositionTool(blank, tool);
    expect(formalManualPageSchema.parse(page)).toEqual(parseCoursewareDoc(page));
    expect(blank.layout.blocks).toEqual([]);
  });

  it("retains text, formula, shape, image and page-bound H5 insertion contracts", () => {
    const blank = createEmptyCoursewareCompositionPage();
    const nodes = [
      ...(["text", "formula", "shape"] as const).map((kind) => createCoursewareInsertedNode(kind, 1, blank.canvas)),
      createCoursewareInsertedImageNode("a".repeat(64), 1, blank.canvas),
      createCoursewareInsertedH5Node("b".repeat(64), 1, blank.canvas),
    ];
    for (const node of nodes) {
      const doc = addCoursewareCompositionNode(blank, node, { columnSpan: 4, rowSpan: 4 });
      expect(formalManualPageSchema.safeParse(doc).success).toBe(true);
      expect(parseCoursewareDoc(doc)).toEqual(doc);
    }
  });

  it("rejects mismatched resources, private source pointers and unregistered tools", () => {
    const blank = createEmptyCoursewareCompositionPage();
    const image = createCoursewareInsertedImageNode("a".repeat(64), 1, blank.canvas);
    image.resources[0].kind = "h5";
    expect(formalManualPageSchema.safeParse(addCoursewareCompositionNode(blank, image, { columnSpan: 4, rowSpan: 4 })).success).toBe(false);
    expect(formalManualPageSchema.safeParse({ ...blank, source: { draftId: "private" } }).success).toBe(false);
    const genericTool = addCoursewareCompositionTool(blank, { toolId: "spatial-lab", contentVersion: "tool-embed-v1" });
    expect(formalManualPageSchema.safeParse(genericTool).success).toBe(false);
  });
});

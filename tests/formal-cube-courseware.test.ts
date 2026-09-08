import { describe, expect, it } from "vitest";
import { createFormalCubePage, formalCubeDirectory, formalCubePageSchema } from "@/features/courseware-studio/formal-cube-page-contract";
import { createCubeCoursewareTool } from "@/features/tools/courseware/cube-structures-content";
import { cubeDraftSnapshot } from "@/features/tools/spatial-lab/cube-structures-draft";
import { createCubeSession } from "@/features/tools/spatial-lab/cube-structures-session";
import { createCoursewareInsertedNode } from "@/features/courseware-doc/courseware-inserted-node";
import { addCoursewareCompositionNode, removeCoursewareCompositionBlock } from "@/features/courseware-doc/composition-page-layout";
import { collectCoursewareDocBindingKeys, parseCoursewareDoc } from "@/features/courseware-doc/document";
import { resolveClassroomInteractionAudit } from "@/features/classroom/sync/interaction-audit";
import { toolCoursewareContractsForSurface } from "@/features/tools/courseware/registry";

const tool = () => createCubeCoursewareTool({ name: "Formal cubes", snapshot: cubeDraftSnapshot(createCubeSession([{ x: 0, y: 0, z: 0 }]), 0) }, "current", ["cut", "orbit"]);

describe("formal cube composition pages", () => {
  it("uses the existing document and renderer contracts with a self-contained full-page fixed copy", () => {
    const source = tool();
    const page = createFormalCubePage(source);
    expect(parseCoursewareDoc(JSON.parse(JSON.stringify(page)))).toEqual(page);
    expect(page.source).toBeNull();
    expect(page.layout.blocks[0]).toMatchObject({ type: "tool", placement: { columnSpan: 12, rowSpan: 9 } });
    expect(collectCoursewareDocBindingKeys(page)).toBeNull();
    expect(page.overlay.nodes).toEqual([]);
    expect(page.overlay.canvas.backgroundBindingKey).toBeNull();
    expect(resolveClassroomInteractionAudit(page).provider).toMatchObject({ protocol: "tool-state-v1", mode: "snapshot" });
    source.payload.toolbar.length = 0;
    const block = page.layout.blocks[0];
    expect(block.type === "tool" && block.tool.contentVersion === "cube-structures-lesson-v2" && block.tool.payload.toolbar).toEqual(["cut", "orbit"]);
  });

  it("keeps toolbar configuration strict and excludes private pointers, generic tools and legacy versions", () => {
    expect(toolCoursewareContractsForSurface("formal-courseware").map((contract) => contract.contentVersion)).toEqual(["cube-structures-lesson-v2"]);
    const page = createFormalCubePage(tool());
    const change = (value: unknown) => ({ ...page, layout: { ...page.layout, blocks: [{ ...page.layout.blocks[0], tool: value }] } });
    expect(formalCubePageSchema.safeParse(change({ ...tool(), contentVersion: "cube-structures-lesson-v3" })).success).toBe(false);
    expect(formalCubePageSchema.safeParse(change({ toolId: "spatial-lab", contentVersion: "tool-embed-v1" })).success).toBe(false);
    expect(formalCubePageSchema.safeParse(change({ ...tool(), draftId: "private" })).success).toBe(false);
    const saved = tool();
    expect(formalCubePageSchema.safeParse(change({ ...saved, payload: { ...saved.payload, toolbar: ["cut", "cut"] } })).success).toBe(false);
  });

  it("permits text and shapes after removing or resizing the initial cube, without enabling resource upload", () => {
    const empty = removeCoursewareCompositionBlock(createFormalCubePage(tool()), "cube-1");
    expect(formalCubePageSchema.parse(empty)).toEqual(empty);
    for (const kind of ["text", "formula", "shape"] as const) {
      const node = createCoursewareInsertedNode(kind, 1, empty.canvas, `mathin-${kind}-1`);
      const page = addCoursewareCompositionNode(empty, node, { columnSpan: 4, rowSpan: 3 });
      expect(formalCubePageSchema.safeParse(page).success).toBe(true);
      page.overlay.nodes[0].resources.push({ bindingKey: "a".repeat(64), bindingPath: "$.src", role: "image", kind: "image" });
      expect(formalCubePageSchema.safeParse(page).success).toBe(false);
    }
  });

  it("rejects source overlays, external backgrounds and H5 blocks", () => {
    const page = createFormalCubePage(tool());
    page.overlay.canvas.backgroundBindingKey = "b".repeat(64);
    expect(formalCubePageSchema.safeParse(page).success).toBe(false);
    page.overlay.canvas.backgroundBindingKey = null;
    const withH5 = { ...page, layout: { ...page.layout, blocks: [{ id: "h5-1", type: "h5", placement: page.layout.blocks[0].placement,
      h5: { artifactId: "77777777-7777-4777-8777-777777777777", sha256: "a".repeat(64), byteCount: 10, entryPath: "index.html" } }] } };
    expect(formalCubePageSchema.safeParse(withH5).success).toBe(false);
    expect(formalCubePageSchema.safeParse({ ...page, source: { privateDraftId: "x" } }).success).toBe(false);
  });

  it("appends unpublished cube pages while preserving release indexes and stable IDs", () => {
    const published = [{ pageDocId: "source", title: "Source" }, { pageDocId: "cube-a", title: "Old title" }];
    const cubes = [{ pageDocId: "cube-a", title: "Renamed", pageNo: 2 }, { pageDocId: "cube-b", title: "New draft", pageNo: 3 }];
    const before = JSON.stringify(published);
    expect(formalCubeDirectory(published, cubes)).toEqual([
      { pageDocId: "source", title: "Source", releasePage: 1, cube: false },
      { pageDocId: "cube-a", title: "Renamed", releasePage: 2, cube: true },
      { pageDocId: "cube-b", title: "New draft", releasePage: null, cube: true },
    ]);
    expect(JSON.stringify(published)).toBe(before);
    expect(formalCubeDirectory([], cubes)).toHaveLength(2);
  });

  it("uses current draft order and omits deleted pages without changing the release directory", () => {
    const released = [{ pageDocId: "a", title: "Old A" }, { pageDocId: "deleted", title: "Retained release page" }, { pageDocId: "b", title: "B" }];
    const current = [
      { pageDocId: "b", title: "B", pageNo: 1, composition: false, nativeAvailable: true, adaptedAvailable: false },
      { pageDocId: "new", title: "Blank", pageNo: 2, composition: true, nativeAvailable: true, adaptedAvailable: true },
      { pageDocId: "a", title: "Renamed A", pageNo: 3, composition: false, nativeAvailable: true, adaptedAvailable: false },
    ];
    expect(formalCubeDirectory(released, [current[1]], current)).toEqual([
      { pageDocId: "b", title: "B", releasePage: 3, cube: false },
      { pageDocId: "new", title: "Blank", releasePage: null, cube: true },
      { pageDocId: "a", title: "Renamed A", releasePage: 1, cube: false },
    ]);
    expect(released.map((page) => page.pageDocId)).toEqual(["a", "deleted", "b"]);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createCubeNetGalleryCatalog, unitSquareNetCanonicalKey, unitSquareNet } from "@/features/spatial-math/domain";
import { CUBE_NET_THUMBNAIL, groupCubeNetTeachingGallery } from "@/features/tools/spatial-lab/cube-net-teaching-gallery";

describe("ordered, non-modal cube-net teaching gallery", () => {
  it("orders 6/3/1/1 nets by 141/132/222/33, each laid out horizontally with the same unit scale", () => {
    const entries = createCubeNetGalleryCatalog().entries.filter((entry) => entry.classification === "legal");
    const groups = groupCubeNetTeachingGallery(entries);
    expect(groups.map((group) => group.family)).toEqual(["141", "132", "222", "33"]);
    expect(groups.map((group) => group.items.length)).toEqual([6, 3, 1, 1]);
    expect(new Set(groups.flatMap((group) => group.items.map((item) => item.entry.id))).size).toBe(11);
    for (const group of groups) for (const item of group.items) {
      expect(item.cells).toHaveLength(6);
      expect(unitSquareNetCanonicalKey(unitSquareNet(item.cells))).toBe(item.entry.canonicalKey);
      expect(Math.max(...item.cells.map((cell) => cell.y)) + 1).toBeLessThanOrEqual(3);
      expect(Math.max(...item.cells.map((cell) => cell.x)) + 1).toBeLessThan(CUBE_NET_THUMBNAIL.columns);
      expect(Array.from({ length: group.family.length }, (_, row) => item.cells.filter((cell) => cell.y === row).length).join("")).toBe(group.family);
    }
    expect(groupCubeNetTeachingGallery([...entries].reverse())).toEqual(groups);
  });
  it("uses the shared bottom floating panel and a single scrollable icon row, without closing on selection", () => {
    const source = readFileSync("src/features/tools/spatial-lab/CubeNetFoldWorkspace.tsx", "utf8");
    const window = readFileSync("src/features/tools/spatial-lab/CubeNetGalleryWindow.tsx", "utf8");
    const styles = readFileSync("src/features/tools/spatial-lab/CubeNetGalleryWindow.module.css", "utf8");
    expect(source).not.toMatch(/<Dialog|DialogContent/);
    expect(source.slice(source.indexOf("const selectEntry ="), source.indexOf("const chooseView ="))).not.toContain("setGalleryOpen(false)");
    expect(window).toContain('<CubeCanvasPanel'); expect(window).toContain('anchor="bottom"');
    expect(window).not.toMatch(/<h3|galleryFamily|aria-modal/);
    expect(window).toContain('viewBox={`0 0 ${columns} ${rows}`}'); expect(window).toContain('width="1" height="1"');
    expect(styles).toContain("flex-wrap: nowrap"); expect(styles).toContain("overflow-x: auto");
    expect(styles).toContain("flex: 0 0 96px"); expect(styles).not.toContain("grid-template-columns");
    expect(source).not.toContain("galleryStyles.layout");
    expect(source.indexOf("<CubeNetGalleryWindow")).toBeLessThan(source.indexOf('data-cube-net-animation'));
    expect(source).toContain("{ essential: true }"); expect(source).toContain("animating={playback.playing}");
  });
});

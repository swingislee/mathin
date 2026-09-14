import type { CubeNetGalleryEntry, SquareCell } from "@/features/spatial-math/domain";
import { transformCubeNetCell } from "./cube-net-planar-motion";

export const CUBE_NET_TEACHING_FAMILIES = ["141", "132", "222", "33"] as const;
export const CUBE_NET_THUMBNAIL = { columns: 6, rows: 4, cellPx: 16 } as const;
export type CubeNetTeachingFamily = typeof CUBE_NET_TEACHING_FAMILIES[number];

/** 按从上到下的行数分类；八种等距摆放中选择统一朝向，目录 ID 保持不变。 */
export function cubeNetTeachingGalleryItem(entry: CubeNetGalleryEntry) {
  for (const family of CUBE_NET_TEACHING_FAMILIES) {
    const variants: { cells: SquareCell[]; key: string }[] = [];
    for (let turn = 0; turn < 8; turn++) {
      const rotated = entry.net.cells.map((cell) => transformCubeNetCell(cell, turn));
      const minX = Math.min(...rotated.map((cell) => cell.x)), maxY = Math.max(...rotated.map((cell) => cell.y));
      const cells = rotated.map((cell) => ({ x: cell.x - minX, y: maxY - cell.y })).sort((a, b) => a.y - b.y || a.x - b.x);
      const counts = Array.from({ length: Math.max(...cells.map((cell) => cell.y)) + 1 }, (_, row) => cells.filter((cell) => cell.y === row).length).join("");
      if (counts === family) variants.push({ cells, key: cells.map((cell) => `${cell.y},${cell.x}`).join(";") });
    }
    variants.sort((a, b) => a.key.localeCompare(b.key));
    if (variants[0]) return { entry, family, ...variants[0] };
  }
  throw new Error(`CUBE_NET_TEACHING_FAMILY_NOT_FOUND: ${entry.id}`);
}

export function groupCubeNetTeachingGallery(entries: readonly CubeNetGalleryEntry[]) {
  const items = entries.map(cubeNetTeachingGalleryItem);
  return CUBE_NET_TEACHING_FAMILIES.map((family) => ({ family,
    items: items.filter((item) => item.family === family).sort((a, b) => a.key.localeCompare(b.key)),
  }));
}

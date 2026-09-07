import { voxelKey, type Axis } from "@/features/spatial-math/domain";
import { cubeDisplayPosition, type CubeStructureState } from "./cube-structures-contract";

/** 连续拆开后，每个位移片区各有对应截面，预览仍对应原整数层间边界。 */
export function cubeCutPreviewPlanes(state: CubeStructureState, axis: Axis, after: number, ids: readonly string[]) {
  const groups = new Map<string, typeof state.cubes>();
  for (const cube of state.cubes) {
    if (!ids.includes(cube.id) || state.hiddenCubeIds.includes(cube.id)) continue;
    const key = voxelKey(cube.displayOffset ?? { x: 0, y: 0, z: 0 });
    groups.set(key, [...(groups.get(key) ?? []), cube]);
  }
  return [...groups.entries()].filter(([, cubes]) => cubes.some((cube) => cube.position[axis] <= after) && cubes.some((cube) => cube.position[axis] > after)).map(([key, cubes]) => {
    const positions = cubes.map(cubeDisplayPosition);
    const ranges = Object.fromEntries((["x", "y", "z"] as const).map((a) => [a, { min: Math.min(...positions.map((p) => p[a])), max: Math.max(...positions.map((p) => p[a])) }])) as Record<Axis, { min: number; max: number }>;
    return { key, center: { x: (ranges.x.min + ranges.x.max) / 2, y: (ranges.y.min + ranges.y.max) / 2, z: (ranges.z.min + ranges.z.max) / 2, [axis]: after + 0.5 + (cubes[0].displayOffset?.[axis] ?? 0) },
      size: { x: axis === "x" ? 0.02 : ranges.x.max - ranges.x.min + 1.2, y: axis === "y" ? 0.02 : ranges.y.max - ranges.y.min + 1.2, z: axis === "z" ? 0.02 : ranges.z.max - ranges.z.min + 1.2 } };
  });
}

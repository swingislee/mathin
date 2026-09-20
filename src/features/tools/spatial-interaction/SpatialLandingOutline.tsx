"use client";

import { useMemo } from "react";
import type { VoxelCoordinate } from "@/features/spatial-math/domain";
import { buildVoxelEdgeInstances } from "@/features/spatial-math/renderer-r3f/voxel-visual-model";

/** 落位提示共用去重棱边，只画一像素虚线；不填面、不参与拾取。 */
export function SpatialLandingOutline({ cells, color }: { cells: readonly VoxelCoordinate[]; color: string }) {
  const lines = useMemo(() => {
    const edges = buildVoxelEdgeInstances(cells), positions: number[] = [], distances: number[] = [];
    for (const axis of ["x", "y", "z"] as const) for (const edge of edges[axis]) {
      for (const side of [-0.5, 0.5]) positions.push(edge.center.x + (axis === "x" ? side : 0), edge.center.y + (axis === "y" ? side : 0), edge.center.z + (axis === "z" ? side : 0));
      distances.push(0, 1);
    }
    return { positions: new Float32Array(positions), distances: new Float32Array(distances) };
  }, [cells]);
  return <lineSegments raycast={() => null} renderOrder={7}>
    <bufferGeometry>
      <bufferAttribute attach="attributes-position" args={[lines.positions, 3]} />
      <bufferAttribute attach="attributes-lineDistance" args={[lines.distances, 1]} />
    </bufferGeometry>
    <lineDashedMaterial color={color} linewidth={1} dashSize={0.12} gapSize={0.08} transparent opacity={0.85} depthTest={false} depthWrite={false} toneMapped={false} />
  </lineSegments>;
}

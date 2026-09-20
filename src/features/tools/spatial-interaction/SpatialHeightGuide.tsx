"use client";

import { Line } from "@react-three/drei";
import type { VoxelCoordinate } from "@/features/spatial-math/domain";
import { CUBE_COLORS, cubeGroupOutlineColor } from "../spatial-lab/cube-structures-contract";

const GUIDE_COLOR = cubeGroupOutlineColor(CUBE_COLORS[5]);
const ignoreRaycast = () => null;
/** 只提示对象到地面的纵向高度，不显示移动平面，也不参与拾取。 */
export function SpatialHeightGuide({ center, groundY, visible = true }: {
  center: VoxelCoordinate; groundY: number; visible?: boolean;
}) {
  return <group name="spatial-move-height-guide" visible={visible}>
    <Line points={[[center.x, center.y, center.z], [center.x, groundY, center.z]]} color={GUIDE_COLOR} lineWidth={1} dashed dashSize={0.1} gapSize={0.1} transparent opacity={0.6} depthWrite={false} raycast={ignoreRaycast} />
    <Line points={[[center.x - 0.13, groundY, center.z], [center.x + 0.13, groundY, center.z]]} color={GUIDE_COLOR} lineWidth={1} raycast={ignoreRaycast} />
    <Line points={[[center.x, groundY, center.z - 0.13], [center.x, groundY, center.z + 0.13]]} color={GUIDE_COLOR} lineWidth={1} raycast={ignoreRaycast} />
  </group>;
}

"use client";

import { useMemo, useRef } from "react";
import { Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Matrix4, Quaternion, Vector3, type Camera, type Group } from "three";
import type { VoxelCoordinate } from "@/features/spatial-math/domain";
import { CUBE_COLORS, cubeGroupOutlineColor } from "../spatial-lab/cube-structures-contract";
import { spatialMoveBasis, spatialViewElevation, type SpatialMoveBasis, type SpatialMovePlane, type SpatialStandardMovePlane, type SpatialMoveViewInfo } from "./object-gesture-math";

const GUIDE_COLOR = cubeGroupOutlineColor(CUBE_COLORS[5]);
const ignoreRaycast = () => null;
function orientation(basis: SpatialMoveBasis) {
  const u = new Vector3(basis.horizontal.x, basis.horizontal.y, basis.horizontal.z), v = new Vector3(basis.vertical.x, basis.vertical.y, basis.vertical.z);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(u, v, u.clone().cross(v)));
}

/** 被动方向提示：边框没有填充，也不截获对象、手柄或空白手势。 */
export function SpatialMoveGuide({ center, radius, plane, visible, lockedBasis, resolvePlane, groundY, onViewChange }: {
  center: VoxelCoordinate; radius: number; plane: SpatialMovePlane; visible: boolean;
  resolvePlane: (camera: Camera) => SpatialStandardMovePlane;
  lockedBasis?: SpatialMoveBasis; groundY?: number; onViewChange?: (view: SpatialMoveViewInfo) => void;
}) {
  const camera = useThree((state) => state.camera), group = useRef<Group>(null);
  const reported = useRef("");
  const initial = orientation(lockedBasis ?? spatialMoveBasis(plane === "auto" ? "table" : plane));
  useFrame(() => {
    const basis = lockedBasis ?? spatialMoveBasis(resolvePlane(camera));
    group.current?.quaternion.copy(orientation(basis));
    const view = { plane: basis.plane, elevation: Math.round(spatialViewElevation(camera)) }, key = JSON.stringify(view);
    if (reported.current !== key) { reported.current = key; onViewChange?.(view); }
  });
  const r = Math.max(1, radius + 0.35);
  const outline = useMemo(() => [[-r, -r, 0], [r, -r, 0], [r, r, 0], [-r, r, 0], [-r, -r, 0]] as [number, number, number][], [r]);
  const ticks = useMemo(() => ([-1, 1] as const).flatMap((sign) => [
    [[sign * r * 0.72, 0, 0], [sign * r, 0, 0]],
    [[sign * (r - 0.12), -0.12, 0], [sign * r, 0, 0], [sign * (r - 0.12), 0.12, 0]],
    [[0, sign * r * 0.72, 0], [0, sign * r, 0]],
    [[-0.12, sign * (r - 0.12), 0], [0, sign * r, 0], [0.12, sign * (r - 0.12), 0]],
  ] as [number, number, number][][]), [r]);
  return <group name="spatial-move-guide" visible={visible}>
    <group ref={group} name="spatial-move-plane" position={[center.x, center.y, center.z]} quaternion={initial}>
      <Line points={outline} color={GUIDE_COLOR} lineWidth={1} dashed dashSize={0.14} gapSize={0.1} transparent opacity={0.65} depthWrite={false} raycast={ignoreRaycast} />
      {ticks.map((points, index) => <Line key={index} points={points} color={GUIDE_COLOR} lineWidth={1} transparent opacity={0.7} depthWrite={false} raycast={ignoreRaycast} />)}
    </group>
    {plane === "auto" && groundY !== undefined && <group name="spatial-move-height-guide">
      <Line points={[[center.x, center.y, center.z], [center.x, groundY, center.z]]} color={GUIDE_COLOR} lineWidth={1} dashed dashSize={0.1} gapSize={0.1} transparent opacity={0.6} depthWrite={false} raycast={ignoreRaycast} />
      <Line points={[[center.x - 0.13, groundY, center.z], [center.x + 0.13, groundY, center.z]]} color={GUIDE_COLOR} lineWidth={1} raycast={ignoreRaycast} />
      <Line points={[[center.x, groundY, center.z - 0.13], [center.x, groundY, center.z + 0.13]]} color={GUIDE_COLOR} lineWidth={1} raycast={ignoreRaycast} />
    </group>}
  </group>;
}

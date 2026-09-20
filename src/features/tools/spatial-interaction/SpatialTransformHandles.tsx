"use client";

import { useMemo, useRef, useState } from "react";
import { Html, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { DoubleSide } from "three";
import { CUBE_AXIS_COLORS } from "../spatial-lab/cube-structures-contract";
import { handlePlaneFacing, planeHandleCorners, rotationPlane, rotationRingPoint, SPATIAL_STANDARD_PLANES, type SpatialTransformHandlesSpec } from "./transform-handles";
import type { SpatialObjectPreview } from "./object-gesture-controller";

const ignoreRaycast = () => null;
const planes = { table: { label: "XZ", axis: "y" }, xy: { label: "XY", axis: "z" }, yz: { label: "YZ", axis: "x" } } as const;
/** 纯舞台手柄；命中复用 transform-handles，与对象指针控制器保持一个入口。 */
export function SpatialTransformHandles({ spec, preview }: { spec: SpatialTransformHandlesSpec; preview?: SpatialObjectPreview | null }) {
  const [facing, setFacing] = useState(7), last = useRef(7);
  useFrame(({ camera }) => {
    const mask = SPATIAL_STANDARD_PLANES.reduce((mask, plane, i) => mask | (handlePlaneFacing(plane, camera) >= 0.18 ? 1 << i : 0), 0);
    if (last.current !== mask) { last.current = mask; setFacing(mask); }
  });
  const current = useMemo(() => {
    const frozen = preview?.handles ?? spec;
    return preview ? { ...frozen, center: {
      x: frozen.center.x + (preview.constraint?.kind === "plane" ? preview.pose.position.x - preview.target.pose.position.x : 0),
      y: frozen.center.y + (preview.constraint?.kind === "plane" ? preview.pose.position.y - preview.target.pose.position.y : 0),
      z: frozen.center.z + (preview.constraint?.kind === "plane" ? preview.pose.position.z - preview.target.pose.position.z : 0),
    } } : frozen;
  }, [preview, spec]);
  const active = preview?.constraint;
  return <group name="spatial-transform-handles">
    {current.mode === "move" ? SPATIAL_STANDARD_PLANES.map((plane, index) => {
      const points = planeHandleCorners(current, plane), color = CUBE_AXIS_COLORS[planes[plane].axis];
      const opacity = !(facing & (1 << index)) || (active?.kind === "plane" && active.plane !== plane) ? 0.16 : 1;
      const vertices = [0, 1, 2, 0, 2, 3].flatMap((i) => points[i].toArray());
      const center = points[0].clone().lerp(points[2], 0.5);
      return <group key={plane} name={`spatial-plane-handle:${plane}`}>
        <mesh raycast={ignoreRaycast} renderOrder={9}><bufferGeometry><bufferAttribute attach="attributes-position" args={[new Float32Array(vertices), 3]} /></bufferGeometry>
          <meshBasicMaterial color={color} side={DoubleSide} transparent opacity={opacity * 0.14} depthTest={false} depthWrite={false} />
        </mesh>
        <Line points={[...points, points[0]]} color={color} lineWidth={active?.kind === "plane" && active.plane === plane ? 2.5 : 1.5} transparent opacity={opacity} depthTest={false} depthWrite={false} raycast={ignoreRaycast} renderOrder={10} />
        <Html position={center} center zIndexRange={[5, 0]} style={{ pointerEvents: "none", opacity }}><span className="select-none text-[10px] font-bold" style={{ color }}>{planes[plane].label}</span></Html>
      </group>;
    }) : (["x", "y", "z"] as const).map((axis) => {
      const plane = rotationPlane(axis), index = SPATIAL_STANDARD_PLANES.indexOf(plane);
      const opacity = !(facing & (1 << index)) || (active?.kind === "axis-rotation" && active.axis !== axis) ? 0.14 : 0.85;
      const points = Array.from({ length: 97 }, (_, i) => rotationRingPoint(current, axis, i * Math.PI / 48));
      return <group key={axis} name={`spatial-rotation-ring:${axis}`}>
        <Line points={points} color={CUBE_AXIS_COLORS[axis]} lineWidth={active?.kind === "axis-rotation" && active.axis === axis ? 3 : 1.7} transparent opacity={opacity} depthTest={false} depthWrite={false} raycast={ignoreRaycast} renderOrder={9} />
        <Html position={rotationRingPoint(current, axis, Math.PI / 4)} center zIndexRange={[5, 0]} style={{ pointerEvents: "none", opacity }}><span className="rounded bg-paper/90 px-1 text-xs font-bold" style={{ color: CUBE_AXIS_COLORS[axis] }}>{axis.toUpperCase()}</span></Html>
      </group>;
    })}
  </group>;
}

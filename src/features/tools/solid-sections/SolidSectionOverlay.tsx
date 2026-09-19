"use client";

import { useEffect, useMemo } from "react";
import { Line } from "@react-three/drei";
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from "three";
import { CUBE_SELECTION_COLOR, CUBE_AXIS_COLORS } from "../spatial-lab/cube-structures-contract";
import type { SolidEntity, SolidVector } from "../solid-geometry/solid-geometry-contract";
import { intersectSolidSection, solidSectionPlaneCorners, type SolidSectionPlane } from "./solid-sections";
import type { SolidSectionFrame } from "./solid-sections-motion";
import { SolidSectionReadout } from "./SolidSectionReadout";

const ignoreRaycast = () => null;
const tuple = (point: SolidVector): [number, number, number] => [point.x, point.y, point.z];
function polygonGeometry(points: readonly SolidVector[]) {
  const positions: number[] = [], geometry = new BufferGeometry();
  for (let i = 1; i < points.length - 1; i++) for (const point of [points[0], points[i], points[i + 1]]) positions.push(point.x, point.y, point.z);
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3)); geometry.computeVertexNormals();
  return geometry;
}
export function SolidSectionOverlay({ entity, frame, plane, locale }: { entity: SolidEntity; frame: SolidSectionFrame; plane: SolidSectionPlane; locale: string }) {
  const result = useMemo(() => intersectSolidSection(entity, plane), [entity, plane]);
  const corners = useMemo(() => solidSectionPlaneCorners(entity, plane), [entity, plane]);
  const cap = useMemo(() => polygonGeometry(result.points), [result.points]);
  const guide = useMemo(() => polygonGeometry(corners), [corners]);
  useEffect(() => () => { cap.dispose(); guide.dispose(); }, [cap, guide]);
  return <group name={`solid-section:${entity.id}`}>
    {frame.planeOpacity > 0.001 && <><mesh geometry={guide} raycast={ignoreRaycast} renderOrder={1}>
      <meshBasicMaterial color={CUBE_AXIS_COLORS.z} opacity={frame.planeOpacity} transparent side={DoubleSide} depthWrite={false} />
    </mesh><Line points={[...corners, corners[0]].map(tuple)} color={CUBE_AXIS_COLORS.z} lineWidth={1.2} transparent opacity={Math.min(1, frame.planeOpacity * 4)} depthWrite={false} dashed dashSize={0.1} gapSize={0.07} raycast={ignoreRaycast} /></>}
    {result.kind === "polygon" && <mesh geometry={cap} raycast={ignoreRaycast} renderOrder={6}>
      <meshBasicMaterial color={CUBE_SELECTION_COLOR} transparent opacity={frame.sectionOpacity * 0.6} side={DoubleSide} depthTest={false} depthWrite={false} />
    </mesh>}
    {result.points.length >= 2 && <Line points={(result.kind === "polygon" ? [...result.points, result.points[0]] : result.points).map(tuple)} color={CUBE_SELECTION_COLOR} lineWidth={3} transparent opacity={Math.min(1, frame.sectionOpacity * 1.2)} depthTest={false} depthWrite={false} renderOrder={7} raycast={ignoreRaycast} />}
    {result.kind === "point" && <mesh position={tuple(result.points[0])} raycast={ignoreRaycast} renderOrder={7}><sphereGeometry args={[0.035, 12, 8]} /><meshBasicMaterial color={CUBE_SELECTION_COLOR} transparent opacity={frame.sectionOpacity} depthTest={false} depthWrite={false} /></mesh>}
    <SolidSectionReadout entity={entity} plane={plane} result={result} locale={locale} opacity={frame.sectionOpacity} />
  </group>;
}

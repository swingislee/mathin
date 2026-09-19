"use client";

import { useMemo } from "react";
import { DoubleSide } from "three";
import { CUBE_AXIS_COLORS, type CubeStructureState } from "../spatial-lab/cube-structures-contract";
import type { ProjectionView } from "./projection-contract";
import { projectionGeometry, type ProjectionPoint } from "./projection-geometry";

const colors = { front: CUBE_AXIS_COLORS.z, right: CUBE_AXIS_COLORS.x, top: CUBE_AXIS_COLORS.y };
function lines(points: readonly ProjectionPoint[]): number[] {
  return points.flatMap((point, index) => [...point, ...points[(index + 1) % points.length]]);
}
function triangles(points: readonly ProjectionPoint[]): number[] {
  return [0, 1, 2, 0, 2, 3].flatMap((index) => [...points[index]]);
}
function ProjectionPlane({ state, view, guides }: { state: CubeStructureState; view: ProjectionView; guides: boolean }) {
  const buffers = useMemo(() => {
    const geometry = projectionGeometry(state, view);
    return {
      faces: new Float32Array(geometry.cells.flatMap((cell) => triangles(cell.corners))),
      edges: new Float32Array([...lines(geometry.frame), ...geometry.cells.flatMap((cell) => lines(cell.corners))]),
      rays: new Float32Array(geometry.cells.flatMap((cell) => cell.ray.flatMap((point) => [...point]))),
    };
  }, [state, view]);
  if (!buffers.faces.length) return null;
  return <group>
    <mesh raycast={() => null} renderOrder={-1} frustumCulled={false}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[buffers.faces, 3]} /></bufferGeometry>
      <meshBasicMaterial color={colors[view]} side={DoubleSide} opacity={0.3} transparent depthWrite={false} toneMapped={false} polygonOffset polygonOffsetFactor={1} />
    </mesh>
    <lineSegments raycast={() => null} frustumCulled={false}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[buffers.edges, 3]} /></bufferGeometry>
      <lineBasicMaterial color={colors[view]} toneMapped={false} />
    </lineSegments>
    {guides && <lineSegments raycast={() => null} frustumCulled={false}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[buffers.rays, 3]} /></bufferGeometry>
      <lineBasicMaterial color={colors[view]} opacity={0.5} transparent depthWrite={false} toneMapped={false} />
    </lineSegments>}
  </group>;
}
/** 直接消费共用拖拽/动画的展示帧，投影不维护第二份运动时钟。 */
export function ProjectionScene({ state, views, guides }: { state: CubeStructureState; views: readonly ProjectionView[]; guides: boolean }) {
  return <>{views.map((view) => <ProjectionPlane key={view} state={state} view={view} guides={guides} />)}</>;
}

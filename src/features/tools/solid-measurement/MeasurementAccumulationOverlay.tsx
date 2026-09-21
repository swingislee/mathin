"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { BoxGeometry, BufferGeometry, EdgesGeometry, Float32BufferAttribute, Matrix4, type InstancedMesh } from "three";
import type { SolidEntity } from "../solid-geometry/solid-geometry-contract";
import { CUBE_COLORS, cubeGroupOutlineColor } from "../spatial-lab/cube-structures-contract";
import { useSpatialPresentation } from "../spatial-interaction/useSpatialPresentation";
import { accumulationCells, formatModelMeasurement } from "./measurement-units";
import type { MeasurementV2Settings } from "./measurement-v2-contract";

const noRaycast = () => null;
const interpolate = (from: number, to: number, t: number) => from + (to - from) * t;
/** 同一模型按单位边、单位面、单位体依次累积；显示单位的换算不改实体大小。 */
export function MeasurementAccumulationOverlay({ entity, settings, locale, onAnimating }: { entity: SolidEntity; settings: MeasurementV2Settings; locale: string; onAnimating?: (active: boolean) => void }) {
  const cells = useMemo(() => accumulationCells(entity, settings.accumulation), [entity, settings.accumulation]);
  const identity = `${entity.id}:${JSON.stringify(entity.dimensions)}:${settings.accumulation}`;
  const target = Math.min(cells.length, settings.accumulationCount);
  const presentation = useSpatialPresentation({ target, key: `${identity}:${target}`, interpolate, durationMs: Math.min(4200, Math.max(700, cells.length * 110)) });
  useEffect(() => { onAnimating?.(presentation.animating); }, [onAnimating, presentation.animating]);
  useEffect(() => () => onAnimating?.(false), [onAnimating]);
  const mesh = useRef<InstancedMesh>(null), invalidate = useThree((s) => s.invalidate);
  const amount = Math.max(0, Math.min(cells.length, presentation.value));
  const edges = useMemo(() => {
    const box = new BoxGeometry(1, 1, 1), source = new EdgesGeometry(box), points = source.getAttribute("position"), result: number[] = [];
    for (const cell of cells.slice(0, Math.ceil(amount))) for (let i = 0; i < points.count; i++) result.push(points.getX(i) * cell.size.x + cell.center.x, points.getY(i) * cell.size.y + cell.center.y, points.getZ(i) * cell.size.z + cell.center.z);
    const geometry = new BufferGeometry(); geometry.setAttribute("position", new Float32BufferAttribute(result, 3)); box.dispose(); source.dispose(); return geometry;
  }, [cells, amount]);
  useEffect(() => () => edges.dispose(), [edges]);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const matrix = new Matrix4();
    cells.forEach((cell, index) => { const progress = Math.max(0, Math.min(1, amount - index)); matrix.makeScale(cell.size.x * progress, cell.size.y * progress, cell.size.z * progress); matrix.setPosition(cell.center.x, cell.center.y + (1 - progress) * 0.7, cell.center.z); mesh.current!.setMatrixAt(index, matrix); });
    mesh.current.instanceMatrix.needsUpdate = true; mesh.current.computeBoundingSphere(); invalidate();
  }, [cells, amount, invalidate]);
  if (!cells.length || settings.accumulation === "none") return null;
  const exponent = settings.accumulation === "length" ? 1 : settings.accumulation === "area" ? 2 : 3;
  return <group position={[entity.position.x, entity.position.y, entity.position.z]} rotation={[entity.rotation.x, entity.rotation.y, entity.rotation.z]} name={`measurement-accumulation:${entity.id}`}>
    <instancedMesh ref={mesh} args={[undefined, undefined, cells.length]} raycast={noRaycast}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={CUBE_COLORS[1]} roughness={0.8} /></instancedMesh>
    <lineSegments geometry={edges} raycast={noRaycast}><lineBasicMaterial color={cubeGroupOutlineColor(CUBE_COLORS[1])} /></lineSegments>
    <Html center position={[0, -entity.dimensions.height / 2 - 0.48, entity.dimensions.depth / 2]} style={{ pointerEvents: "none" }} zIndexRange={[5, 0]}><span className="whitespace-nowrap rounded bg-paper/95 px-2 py-1 text-xs">{Math.floor(amount)} / {cells.length} · {formatModelMeasurement(Math.floor(amount), locale, exponent, settings)}</span></Html>
  </group>;
}

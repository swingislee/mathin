"use client";

import { useCallback, useMemo, useState } from "react";
import { Edges, Html, Line } from "@react-three/drei";
import { DoubleSide } from "three";
import { CubeMoveHandles } from "../spatial-lab/CubeMoveHandles";
import type { CubeDragPreview } from "../spatial-lab/cube-structures-drag-controller";
import { CUBE_AXIS_COLORS, CUBE_COLORS, CUBE_SELECTION_COLOR } from "../spatial-lab/cube-structures-contract";
import { createSolidEntity } from "../solid-geometry/solid-geometry-contract";
import { solidDragState } from "../solid-geometry/solid-geometry-drag";
import type { DisplacementSnapshot } from "./displacement-contract";
import { displacementBlocks, placeDisplacementBody, solveDisplacement, type DisplacementLimit } from "./displacement-math";
import { displacementMessages } from "./displacement-messages";

const ID = "displacement-body", ignoreRaycast = () => null, noop = () => {};
const number = (value: number) => Number(value.toFixed(2)).toString();
export interface DisplacementSceneProps {
  snapshot: DisplacementSnapshot; frame: DisplacementSnapshot; locale: string; disabled: boolean; selectionActive: boolean;
  showMoveHandle?: boolean;
  onSelect: () => void; onPreview: (next: DisplacementSnapshot | null) => void; onDragging: (active: boolean) => void;
  onCommit: (next: DisplacementSnapshot) => boolean; onLimit: (limit: DisplacementLimit) => void;
}
/** 浸入演示只允许竖向手柄；指针捕获、取消与相机仍由共用舞台管理。 */
export function DisplacementScene({ snapshot, frame, locale, disabled, selectionActive, showMoveHandle = false, onSelect, onPreview, onDragging, onCommit, onLimit }: DisplacementSceneProps) {
  const [preview, setPreview] = useState<CubeDragPreview | null>(null);
  const m = displacementMessages(locale), { tank, body } = frame, result = solveDisplacement(frame);
  const state = useMemo(() => solidDragState([createSolidEntity("cuboid", ID, { x: 0, y: snapshot.body.bottom + snapshot.body.height + 0.05, z: 0 })]), [snapshot]);
  const presentation = useMemo(() => solidDragState([createSolidEntity("cuboid", ID, { x: 0, y: body.bottom + body.height + 0.05, z: 0 })]), [body.bottom, body.height]);
  const handlePreview = useCallback((next: CubeDragPreview | null) => {
    if (!next) { setPreview(null); onPreview(null); onDragging(false); return; }
    const moved = next.positions.get(ID);
    if (!moved) return;
    const placed = placeDisplacementBody(snapshot, moved.y - snapshot.body.height - 0.05);
    setPreview({ ...next, valid: true, positions: new Map([[ID, { x: 0, y: placed.state.body.bottom + snapshot.body.height + 0.05, z: 0 }]]) });
    onPreview(placed.state); onDragging(true); onLimit(placed.limit);
  }, [snapshot, onPreview, onDragging, onLimit]);
  const x = tank.width / 2, z = tank.depth / 2;
  const ring = (height: number): [number, number, number][] => [[-x, height, -z], [x, height, -z], [x, height, z], [-x, height, z], [-x, height, -z]];
  return <>
    <group name="displacement-tank">
      <mesh position={[0, -0.035, 0]} raycast={ignoreRaycast}><boxGeometry args={[tank.width + 0.08, 0.07, tank.depth + 0.08]} /><meshStandardMaterial color={CUBE_COLORS[5]} transparent opacity={0.18} depthWrite={false} /></mesh>
      {[[-x, 0], [x, 0]].map(([side], i) => <mesh key={`x${i}`} position={[side, tank.height / 2, 0]} rotation={[0, Math.PI / 2, 0]} raycast={ignoreRaycast}><planeGeometry args={[tank.depth, tank.height]} /><meshStandardMaterial color="#a9bfc5" transparent opacity={0.08} depthWrite={false} side={DoubleSide} /></mesh>)}
      {[-z, z].map((side, i) => <mesh key={`z${i}`} position={[0, tank.height / 2, side]} raycast={ignoreRaycast}><planeGeometry args={[tank.width, tank.height]} /><meshStandardMaterial color="#a9bfc5" transparent opacity={0.08} depthWrite={false} side={DoubleSide} /></mesh>)}
      {[0, tank.height].map((height) => <Line key={height} points={ring(height)} color="#84999e" lineWidth={1.3} raycast={ignoreRaycast} />)}
      {[-x, x].flatMap((a) => [-z, z].map((b) => <Line key={`${a}:${b}`} points={[[a, 0, b], [a, tank.height, b]]} color="#84999e" lineWidth={1.3} raycast={ignoreRaycast} />))}
      <mesh position={[0, result.waterHeight / 2, 0]} raycast={ignoreRaycast} renderOrder={2}><boxGeometry args={[tank.width * 0.998, result.waterHeight, tank.depth * 0.998]} /><meshStandardMaterial color="#78abc2" transparent opacity={0.32} depthWrite={false} side={DoubleSide} roughness={0.4} /></mesh>
      <Line points={ring(result.waterHeight)} color="#497d96" lineWidth={1.5} raycast={ignoreRaycast} />
      {snapshot.showInitialLevel && <Line points={ring(tank.waterHeight)} color="#887a62" lineWidth={1.2} dashed dashSize={0.12} gapSize={0.09} raycast={ignoreRaycast} depthWrite={false} />}
      {snapshot.showDimensions && <Html center position={[0, -0.35, z]} style={{ pointerEvents: "none", whiteSpace: "nowrap" }} zIndexRange={[3, 0]}><span className="rounded bg-paper/90 px-1 text-xs">{number(tank.width)} × {number(tank.depth)} × {number(tank.height)} {m.units}</span></Html>}
    </group>
    <group name="displacement-object" position={[0, body.bottom, 0]} userData={{ spatialObjectId: ID }}>
      {displacementBlocks(body).map((block, index) => <mesh key={index} position={[block.x, block.y, block.z]} onClick={(event) => { if (!disabled && event.button === 0 && event.delta < 4) { event.stopPropagation(); onSelect(); } }}>
        <boxGeometry args={[block.width, block.height, block.depth]} /><meshStandardMaterial color={CUBE_COLORS[0]} roughness={0.72} />
        <Edges color={selectionActive ? CUBE_SELECTION_COLOR : "#5f683d"} lineWidth={selectionActive ? 1.8 : 1.2} raycast={ignoreRaycast} />
      </mesh>)}
    </group>
    {selectionActive && <Line points={[[0, 0, 0], [0, body.bottom, 0]]} color={CUBE_AXIS_COLORS.y} lineWidth={1} dashed dashSize={0.1} gapSize={0.08} raycast={ignoreRaycast} depthWrite={false} />}
    <CubeMoveHandles presentation={presentation} preview={preview} onPreview={handlePreview} interaction={{ state, ids: [ID], scopeIds: [ID], axis: "y", kind: "display-move", snapToGrid: false,
      bodyAxis: "handles", handleAxes: ["y"], continuousPreview: true, continuousDistance: true, enabled: !disabled, showHandles: showMoveHandle && selectionActive,
      onAxisChange: noop, onSelect, onUnavailable: noop, isValidOperation: () => true,
      onCommit: (operation) => { const placed = placeDisplacementBody(snapshot, snapshot.body.bottom + operation.distance); onLimit(placed.limit); onCommit(placed.state); onSelect(); },
    }} />
  </>;
}

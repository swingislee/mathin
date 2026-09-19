"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Html } from "@react-three/drei";
import { Quaternion, Vector3 } from "three";
import type { Axis } from "@/features/spatial-math/domain";
import { VoxelGeometry, VoxelModelCanvas } from "@/features/spatial-math/renderer-r3f/VoxelCanvas";
import type { VoxelRendererMessages } from "@/features/spatial-math/renderer-r3f/VoxelFallback";
import { CubeMoveHandles } from "../spatial-lab/CubeMoveHandles";
import type { CubeDragPreview } from "../spatial-lab/cube-structures-drag-controller";
import type { CubeMoveOperation } from "../spatial-lab/cube-structures-drag";
import { somaCubeState, somaDrag, somaDragPresentation, somaIdFromCell, somaRenderModel, somaVisiblePieces } from "./model";
import { SOMA_PIECES, somaDefinition, type SomaId } from "./pieces";
import type { SomaSnapshot } from "./contract";
import { somaRigidPoses } from "./motion";
import { interpolateRigidPoses } from "../spatial-interaction/rigid-motion";
import { useSpatialPresentation } from "../spatial-interaction/useSpatialPresentation";
import { spatialDirectManipulation } from "../spatial-interaction/policy";
import { SpatialRotationControls } from "../spatial-interaction/SpatialRotationControls";
import { CUBE_COLORS, CUBE_SELECTION_COLOR } from "../spatial-lab/cube-structures-contract";
import { somaMessages } from "./messages";

const colors = Object.fromEntries(SOMA_PIECES.map((piece) => [piece.color, piece.color]));
export interface SomaCanvasProps {
  snapshot: SomaSnapshot; messages: VoxelRendererMessages; title: string; readOnly: boolean; axisSnap: boolean;
  navigation: "orbit" | "pan" | "move"; moveAxis: Axis; onMoveAxis: (axis: Axis) => void;
  onSelect: (id: SomaId) => void; onMove: (operation: CubeMoveOperation) => void; onUnavailable: () => void; onDragging: (value: boolean) => void;
  onRotate: (axis: Axis, turn: -1 | 1) => void; onMoving: (value: boolean) => void; instantKey?: string | null; locale: string;
  cameraInteractive?: boolean;
}
export default function SomaCanvas({ snapshot, messages, title, readOnly, axisSnap, navigation, moveAxis, onMoveAxis, onSelect, onMove, onUnavailable, onDragging, onMoving, onRotate, instantKey, locale, cameraInteractive = !readOnly }: SomaCanvasProps) {
  const visible = useMemo(() => somaVisiblePieces(snapshot), [snapshot]);
  // 选择另一宝时只改变手柄目标；同一拼搭的命中几何保持身份，保留正在开始的拖动。
  const pieces = snapshot.mode === "assemble" ? snapshot.pieces : visible;
  const state = useMemo(() => somaCubeState(pieces), [pieces]);
  const [preview, setPreview] = useState<CubeDragPreview | null>(null);
  const presentation = useMemo(() => somaDragPresentation(state, preview), [state, preview]);
  const model = useMemo(() => somaRenderModel(state, snapshot, title, presentation), [state, presentation, snapshot, title]);
  const target = useMemo(() => somaRigidPoses(pieces), [pieces]);
  const motion = useSpatialPresentation({ target, key: JSON.stringify(target), interpolate: interpolateRigidPoses, instantKey });
  const shapes = useMemo(() => pieces.map((piece) => {
    const canonical = somaCubeState([{ ...piece, orientation: 0, position: { x: 0, y: 0, z: 0 } }]);
    return { id: piece.id, model: somaRenderModel(canonical, snapshot, title) };
  }), [pieces, snapshot, title]);
  const direct = spatialDirectManipulation(navigation) && snapshot.mode === "assemble";
  const selectedIds = state.cubes.filter((cube) => somaIdFromCell(cube.id) === snapshot.selectedId).map((cube) => cube.id);
  const selectedPose = motion.value.find((pose) => pose.id === snapshot.selectedId);
  const points = selectedPose ? somaDefinition(snapshot.selectedId).cells.map((p) => new Vector3(p.x, p.y, p.z).applyQuaternion(new Quaternion(...selectedPose.quaternion))
    .add(new Vector3(selectedPose.position.x, selectedPose.position.y, selectedPose.position.z))) : [];
  const middle = (axis: Axis) => (Math.min(...points.map((p) => p[axis])) + Math.max(...points.map((p) => p[axis]))) / 2;
  const center = points.length ? { x: middle("x"), y: middle("y"), z: middle("z") } : null;
  useEffect(() => { onMoving(motion.animating); }, [motion.animating, onMoving]);
  useEffect(() => () => onMoving(false), [onMoving]);
  const dragging = preview !== null;
  useEffect(() => { onDragging(dragging); }, [dragging, onDragging]);
  useEffect(() => () => onDragging(false), [onDragging]);
  const selectCell = useCallback((cell: string) => { const id = somaIdFromCell(cell); if (id) onSelect(id); }, [onSelect]);
  return <VoxelModelCanvas model={{ ...model, cells: [] }} messages={messages} materialColors={colors} preserveSelectedColors
    cameraRequestKey={snapshot.cameraRevision} axisSnapEnabled={axisSnap} readOnly={readOnly} cameraInteractive={cameraInteractive}
    navigationMode={navigation === "move" && snapshot.mode === "assemble" ? "object" : navigation === "pan" ? "pan" : "orbit"}
    sceneOverlay={<>
      {motion.value.map((pose) => {
        const shape = shapes.find((shape) => shape.id === pose.id); if (!shape) return null;
        const cube = state.cubes.find((cube) => somaIdFromCell(cube.id) === pose.id);
        const presented = cube && presentation.cubes.find((item) => item.id === cube.id);
        const offset = cube && presented ? { x: presented.position.x - cube.position.x, y: presented.position.y - cube.position.y, z: presented.position.z - cube.position.z } : { x: 0, y: 0, z: 0 };
        return <group key={pose.id} name={`soma-rigid:${pose.id}`} position={[pose.position.x + offset.x, pose.position.y + offset.y, pose.position.z + offset.z]} quaternion={pose.quaternion}>
          <VoxelGeometry model={shape.model} palette={{ leaf: CUBE_COLORS[0], moon: CUBE_SELECTION_COLOR }} materialColors={colors} preserveSelectedColors
            readOnly={readOnly || direct || motion.animating} onCellSelect={selectCell} />
        </group>;
      })}
      {snapshot.grid && <gridHelper args={[25, 25, "#b8b0a3", "#d9d3c8"]} position={[0, -0.505, 0]} raycast={() => null} />}
      {snapshot.axes && <axesHelper args={[3]} position={[-0.5, -0.5, -0.5]} raycast={() => null} />}
      {snapshot.labels && !motion.animating && pieces.filter((piece) => !direct || piece.id !== snapshot.selectedId).map((piece) => {
        const cells = presentation.cubes.filter((cube) => somaIdFromCell(cube.id) === piece.id);
        const center = (axis: Axis) => (Math.min(...cells.map((cube) => cube.position[axis])) + Math.max(...cells.map((cube) => cube.position[axis]))) / 2;
        return <Html key={piece.id} position={[center("x"), Math.max(...cells.map((cube) => cube.position.y)) + 0.85, center("z")]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
          <span className="whitespace-nowrap rounded bg-paper/90 px-1.5 py-0.5 text-xs text-ink">{somaDefinition(piece.id).name}</span>
        </Html>;
      })}
      {direct && !readOnly && !motion.animating && <CubeMoveHandles presentation={presentation} preview={preview} onPreview={setPreview}
        interaction={{ state, ids: selectedIds, scopeIds: state.cubes.map((cube) => cube.id), bodyAxis: "gesture",
          idsForHit: (id) => state.cubes.filter((cube) => somaIdFromCell(cube.id) === somaIdFromCell(id)).map((cube) => cube.id),
          axis: moveAxis, kind: "move", snapToGrid: true, isValidOperation: (operation) => somaDrag(snapshot, operation) !== null,
          onAxisChange: onMoveAxis, onSelect: selectCell, onCommit: onMove, onUnavailable }} />}
      {direct && !readOnly && center && !preview && <SpatialRotationControls center={center} action={{ axis: moveAxis, onAxisChange: onMoveAxis, onRotate, label: somaMessages(locale).rotate, disabled: motion.animating }} />}
    </>} />;
}

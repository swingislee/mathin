"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Html } from "@react-three/drei";
import type { Axis } from "@/features/spatial-math/domain";
import { VoxelModelCanvas } from "@/features/spatial-math/renderer-r3f/VoxelCanvas";
import type { VoxelRendererMessages } from "@/features/spatial-math/renderer-r3f/VoxelFallback";
import { CubeMoveHandles } from "../spatial-lab/CubeMoveHandles";
import type { CubeDragPreview } from "../spatial-lab/cube-structures-drag-controller";
import type { CubeMoveOperation } from "../spatial-lab/cube-structures-drag";
import { somaCubeState, somaDrag, somaDragPresentation, somaIdFromCell, somaRenderModel, somaVisiblePieces } from "./model";
import { SOMA_PIECES, somaDefinition, type SomaId } from "./pieces";
import type { SomaSnapshot } from "./contract";

const colors = Object.fromEntries(SOMA_PIECES.map((piece) => [piece.color, piece.color]));
export interface SomaCanvasProps {
  snapshot: SomaSnapshot; messages: VoxelRendererMessages; title: string; readOnly: boolean; axisSnap: boolean;
  navigation: "orbit" | "pan" | "move"; moveAxis: Axis; onMoveAxis: (axis: Axis) => void;
  onSelect: (id: SomaId) => void; onMove: (operation: CubeMoveOperation) => void; onUnavailable: () => void; onDragging: (value: boolean) => void;
}
export default function SomaCanvas({ snapshot, messages, title, readOnly, axisSnap, navigation, moveAxis, onMoveAxis, onSelect, onMove, onUnavailable, onDragging }: SomaCanvasProps) {
  const visible = useMemo(() => somaVisiblePieces(snapshot), [snapshot]);
  // 选择另一宝时只改变手柄目标；同一拼搭的命中几何保持身份，保留正在开始的拖动。
  const pieces = snapshot.mode === "assemble" ? snapshot.pieces : visible;
  const state = useMemo(() => somaCubeState(pieces), [pieces]);
  const [preview, setPreview] = useState<CubeDragPreview | null>(null);
  const presentation = useMemo(() => somaDragPresentation(state, preview), [state, preview]);
  const model = useMemo(() => somaRenderModel(presentation, snapshot, title), [presentation, snapshot, title]);
  const dragging = preview !== null;
  useEffect(() => { onDragging(dragging); }, [dragging, onDragging]);
  useEffect(() => () => onDragging(false), [onDragging]);
  const selectCell = useCallback((cell: string) => { const id = somaIdFromCell(cell); if (id) onSelect(id); }, [onSelect]);
  return <VoxelModelCanvas model={model} messages={messages} materialColors={colors} preserveSelectedColors
    cameraRequestKey={snapshot.cameraRevision} axisSnapEnabled={axisSnap} readOnly={readOnly} cameraInteractive={!readOnly}
    navigationMode={navigation === "move" && snapshot.mode === "assemble" ? "object" : navigation === "pan" ? "pan" : "orbit"}
    onCellSelect={navigation === "move" ? undefined : selectCell} sceneOverlay={<>
      {snapshot.grid && <gridHelper args={[25, 25, "#b8b0a3", "#d9d3c8"]} position={[0, -0.505, 0]} raycast={() => null} />}
      {snapshot.axes && <axesHelper args={[3]} position={[-0.5, -0.5, -0.5]} raycast={() => null} />}
      {snapshot.labels && pieces.map((piece) => {
        const cells = presentation.cubes.filter((cube) => somaIdFromCell(cube.id) === piece.id);
        const center = (axis: Axis) => (Math.min(...cells.map((cube) => cube.position[axis])) + Math.max(...cells.map((cube) => cube.position[axis]))) / 2;
        return <Html key={piece.id} position={[center("x"), Math.max(...cells.map((cube) => cube.position.y)) + 0.85, center("z")]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
          <span className="whitespace-nowrap rounded bg-paper/90 px-1.5 py-0.5 text-xs text-ink">{somaDefinition(piece.id).name}</span>
        </Html>;
      })}
      {navigation === "move" && snapshot.mode === "assemble" && !readOnly && <CubeMoveHandles presentation={presentation} preview={preview} onPreview={setPreview}
        interaction={{ state, ids: state.cubes.filter((cube) => somaIdFromCell(cube.id) === snapshot.selectedId).map((cube) => cube.id), scopeIds: state.cubes.map((cube) => cube.id),
          axis: moveAxis, kind: "move", snapToGrid: true, isValidOperation: (operation) => somaDrag(snapshot, operation) !== null,
          onAxisChange: onMoveAxis, onSelect: selectCell, onCommit: onMove, onUnavailable }} />}
    </>} />;
}

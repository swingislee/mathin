"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { VoxelGeometry, VoxelModelCanvas, type VoxelModelCanvasProps } from "@/features/spatial-math/renderer-r3f/VoxelCanvas";
import { CubeStructuresScene } from "./CubeStructuresScene";
import { CUBE_COLORS, CUBE_SELECTION_COLOR, cubeDisplayPosition, cubePaintGroups, type CubeHistory, type CubeStructureState } from "./cube-structures-contract";
import { CubeStructureAnnotations } from "./CubeStructureAnnotations";
import { useCubeDisplayMotion } from "./useCubeDisplayMotion";
import { CubeMoveHandles } from "./CubeMoveHandles";
import type { CubeDragPreview, CubeMoveInteraction } from "./cube-structures-drag-controller";
import { CubeCutPicker } from "./CubeCutPicker";
import type { CubeCutInteraction } from "./cube-structures-cut-controller";
import { SpatialRotationControls, type SpatialRotationAction } from "../spatial-interaction/SpatialRotationControls";
import { cubeRotationOperation } from "./cube-structures-rotation";
import { SpatialRollControls } from "../spatial-interaction/SpatialRollControls";
import type { SpatialRollAction } from "../spatial-interaction/SpatialRollButtons";

/** Three/R3F 与场景预览一起按需加载，工具栏保持在轻量客户端边界。 */
export function CubeStructuresViewport({ scene, sceneKey, history, opacityPreview, moveInteraction, cutInteraction, onMovingChange, onDraggingChange, rotationInteraction, rollInteraction, renderSceneOverlay, ...props }: VoxelModelCanvasProps & {
  readonly scene: ComponentProps<typeof CubeStructuresScene>;
  readonly sceneKey: object;
  readonly history?: CubeHistory;
  readonly opacityPreview: { readonly ids: readonly string[]; readonly opacity: number } | null;
  readonly onMovingChange: (moving: boolean) => void;
  readonly moveInteraction: CubeMoveInteraction | null;
  readonly cutInteraction: CubeCutInteraction | null;
  readonly onDraggingChange?: (dragging: boolean) => void;
  readonly rotationInteraction?: (SpatialRotationAction & { ids: readonly string[] }) | null;
  readonly rollInteraction?: (SpatialRollAction & { ids: readonly string[] }) | null;
  readonly renderSceneOverlay?: (presentation: CubeStructureState) => ReactNode;
}) {
  const [dragPreview, setDragPreview] = useState<CubeDragPreview | null>(null);
  useEffect(() => { onDraggingChange?.(dragPreview !== null); }, [onDraggingChange, dragPreview]);
  useEffect(() => () => onDraggingChange?.(false), [onDraggingChange]);
  const { presentation, moving, previewPositions, rotation } = useCubeDisplayMotion(scene.state, sceneKey, onMovingChange, history);
  const previewDrag = useCallback((preview: CubeDragPreview | null) => { setDragPreview(preview); previewPositions(preview?.positions ?? null); }, [previewPositions]);
  const model = useMemo(() => {
    const positions = new Map(presentation.cubes.map((cube) => [cube.id, cubeDisplayPosition(cube)]));
    return { ...props.model, cells: props.model.cells.filter((cell) => !rotation?.operation.ids.includes(cell.key)).map((cell) => ({ ...cell, ...positions.get(cell.key),
      ...(opacityPreview?.ids.includes(cell.key) ? { opacity: opacityPreview.opacity } : {}) })) };
  }, [props.model, presentation.cubes, opacityPreview, rotation]);
  const stationary = useMemo(() => rotation ? { ...presentation, cubes: presentation.cubes.filter((cube) => !rotation.operation.ids.includes(cube.id)) } : presentation, [presentation, rotation]);
  const paints = useMemo(() => rotation ? cubePaintGroups(stationary) : cubePaintGroups(presentation), [rotation, stationary, presentation]);
  const rotating = useMemo(() => {
    if (!rotation) return null;
    const state = { ...rotation.source, cubes: rotation.source.cubes.filter((cube) => rotation.operation.ids.includes(cube.id)) };
    const positions = new Map(state.cubes.map((cube) => [cube.id, cubeDisplayPosition(cube)]));
    return { state, model: { ...props.model, cells: props.model.cells.filter((cell) => positions.has(cell.key)).map((cell) => ({ ...cell, ...positions.get(cell.key)! })) }, paints: cubePaintGroups(state) };
  }, [rotation, props.model]);
  const pivot = rotation?.operation.displayPivot;
  const rotationPivot = rotationInteraction ? cubeRotationOperation(presentation, rotationInteraction.ids, rotationInteraction.axis, 1)?.displayPivot : null;
  const rolled = rollInteraction ? presentation.cubes.filter((cube) => rollInteraction.ids.includes(cube.id)).map(cubeDisplayPosition) : [];
  const rollCenter = rolled.length ? Object.fromEntries((["x", "y", "z"] as const).map((axis) => [axis, (Math.min(...rolled.map((p) => p[axis])) + Math.max(...rolled.map((p) => p[axis]))) / 2])) as { x: number; y: number; z: number } : null;
  return <VoxelModelCanvas {...props} model={model} paintedFaceGroups={paints} readOnly={props.readOnly || moving}
    preserveSelectedColors sceneOverlay={<>{renderSceneOverlay?.(presentation)}<CubeStructuresScene {...scene} state={stationary} tool={moving ? "orbit" : scene.tool} />
      {rotation && rotating && pivot && <group name="cube-rigid-rotation" position={[pivot.x, pivot.y, pivot.z]}
        rotation={[rotation.operation.axis === "x" ? rotation.angle : 0, rotation.operation.axis === "y" ? rotation.angle : 0, rotation.operation.axis === "z" ? rotation.angle : 0]}>
        <group position={[-pivot.x, -pivot.y, -pivot.z]}>
          <VoxelGeometry model={rotating.model} palette={{ leaf: CUBE_COLORS[0], moon: CUBE_SELECTION_COLOR }} readOnly materialColors={props.materialColors}
            paintedFaceGroups={rotating.paints} preserveSelectedColors />
          <CubeStructureAnnotations state={rotating.state} tool="orbit" face={null} annotation={scene.annotation} />
        </group>
      </group>}
      {moveInteraction && !moving && <CubeMoveHandles interaction={moveInteraction} presentation={presentation} preview={dragPreview} onPreview={previewDrag} />}
      {rotationInteraction && rotationPivot && !dragPreview && <SpatialRotationControls center={rotationPivot} action={{ ...rotationInteraction, disabled: rotationInteraction.disabled || moving }} />}
      {rollInteraction && rollCenter && !dragPreview && <SpatialRollControls center={rollCenter} action={{ ...rollInteraction, disabled: rollInteraction.disabled || moving }} />}
      {cutInteraction && !moving && <CubeCutPicker interaction={cutInteraction} />}
    </>} />;
}

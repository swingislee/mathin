"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { VoxelGeometry, VoxelModelCanvas, type VoxelModelCanvasProps } from "@/features/spatial-math/renderer-r3f/VoxelCanvas";
import { CubeStructuresScene } from "./CubeStructuresScene";
import { applyCubeOperation, CUBE_COLORS, CUBE_SELECTION_COLOR, cubeDisplayPosition, cubePaintGroups, type CubeHistory, type CubeOperation, type CubeStructureState } from "./cube-structures-contract";
import { CubeStructureAnnotations } from "./CubeStructureAnnotations";
import { cubeDisplayMotionKey, useCubeDisplayMotion } from "./useCubeDisplayMotion";
import { CubeMoveHandles } from "./CubeMoveHandles";
import type { CubeDragPreview, CubeMoveInteraction } from "./cube-structures-drag-controller";
import { CubeCutPicker } from "./CubeCutPicker";
import type { CubeCutInteraction } from "./cube-structures-cut-controller";
import { SpatialRotationControls, type SpatialRotationAction } from "../spatial-interaction/SpatialRotationControls";
import { cubeRotationOperation } from "./cube-structures-rotation";
import { SpatialRollControls } from "../spatial-interaction/SpatialRollControls";
import type { SpatialRollAction } from "../spatial-interaction/SpatialRollButtons";
import { unitCubeCorners } from "../spatial-interaction/rolling";
import { cubeDragPick, cubeMoveCenter, cubePlaneOperations } from "./cube-structures-drag";
import { spatialGizmoInteraction, spatialGizmoPoint, snapSpatialTranslation } from "../spatial-interaction/gizmo-adapter";
import type { SpatialObjectPreview } from "../spatial-interaction/object-gesture-controller";
import type { SpatialTransformMode } from "../spatial-interaction/tool-state";

/** Three/R3F 与场景预览一起按需加载，工具栏保持在轻量客户端边界。 */
export function CubeStructuresViewport({ scene, sceneKey, history, opacityPreview, moveInteraction, cutInteraction, onMovingChange, onDraggingChange, rotationInteraction, rollInteraction, renderSceneOverlay, onTransformOperations, transformMode = null, ...props }: VoxelModelCanvasProps & {
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
  readonly onTransformOperations?: (operations: readonly CubeOperation[]) => CubeHistory | null;
  readonly transformMode?: SpatialTransformMode | null;
}) {
  const [dragPreview, setDragPreview] = useState<CubeDragPreview | null>(null);
  const [handleFrame, setHandleFrame] = useState<{ frame: SpatialObjectPreview; source: CubeStructureState; ids: readonly string[]; interaction: CubeMoveInteraction } | null>(null);
  // 松手发布期间宿主会停用新写入，当前落位动画仍保留同一指针控制器到结束。
  const activeMove = moveInteraction ?? handleFrame?.interaction ?? null;
  const [handleDragging, setHandleDragging] = useState(false), [instantKey, setInstantKey] = useState<string | null>(null);
  useEffect(() => { onDraggingChange?.(dragPreview !== null || handleDragging); }, [onDraggingChange, dragPreview, handleDragging]);
  useEffect(() => () => onDraggingChange?.(false), [onDraggingChange]);
  const { presentation, moving, previewPositions, rotation: animationRotation } = useCubeDisplayMotion(scene.state, sceneKey, onMovingChange, history, instantKey);
  const rotation = useMemo(() => {
    if (handleFrame?.frame.constraint?.kind !== "axis-rotation") return animationRotation;
    const { frame, source, ids } = handleFrame, axis = handleFrame.frame.constraint.axis;
    const operation = cubeRotationOperation(source, ids, axis, 1);
    return operation ? { source, operation, angle: 2 * Math.atan2(frame.pose.quaternion[axis === "x" ? 0 : axis === "y" ? 1 : 2], frame.pose.quaternion[3]) } : null;
  }, [handleFrame, animationRotation]);
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
  const rotationVertices = unitCubeCorners(presentation.cubes.filter((cube) => rotationInteraction?.ids.includes(cube.id) && !presentation.hiddenCubeIds.includes(cube.id)).map(cubeDisplayPosition));
  const handleCenter = moveInteraction && cubeMoveCenter(presentation, moveInteraction.ids);
  const toolbarHandles = handleCenter && transformMode === "move" ? { center: handleCenter, axes: moveInteraction?.handleAxes ?? ["x", "y", "z"] as const } : undefined;
  const idsForTarget = (id: string) => activeMove
    ? (activeMove.idsForHit?.(id) ?? (activeMove.ids.includes(id) ? activeMove.ids : [id])).filter((member) => activeMove.scopeIds.includes(member))
    : [];
  const apply = (operations: readonly CubeOperation[]) => {
    if (!operations.length) return true;
    const next = operations.reduce(applyCubeOperation, scene.state);
    const committed = onTransformOperations?.(operations);
    if (!committed) return false;
    setInstantKey(cubeDisplayMotionKey(next, committed)); return true;
  };
  const handleInteraction = onTransformOperations && activeMove ? spatialGizmoInteraction({
    key: scene.state, selectedId: activeMove.ids[0] ?? null,
    mode: transformMode, enabled: !moving && !props.readOnly && !dragPreview,
    showHandles: (activeMove.showHandles === true || transformMode === "rotate" && !!rotationInteraction) && !rollInteraction,
    pick: (raycaster) => { const hit = cubeDragPick(scene.state, raycaster.ray); return hit && activeMove.scopeIds.includes(hit.id) ? hit : null; },
    objectFor: (id) => {
      const ids = idsForTarget(id);
      const center = (transformMode === "rotate" && rotationInteraction ? cubeRotationOperation(scene.state, ids, rotationInteraction.axis, 1)?.displayPivot : null) ?? cubeMoveCenter(scene.state, ids);
      if (!center || !ids.length) return null;
      const vertices = unitCubeCorners(scene.state.cubes.filter((cube) => ids.includes(cube.id)).map(cubeDisplayPosition));
      return { id, center, radius: Math.max(1.4, ...vertices.map((p) => Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z))) + 0.3,
        translate: (delta) => { const snapped = snapSpatialTranslation(delta, activeMove.kind === "move" ? 1 : 0.5);
          const operations = cubePlaneOperations(scene.state, ids, activeMove.kind, snapped);
          return { delta: snapped, valid: operations !== null, apply: () => operations !== null && apply(operations) }; },
        rotate: (axis, turn) => { const operation = cubeRotationOperation(scene.state, ids, axis, turn);
          return { valid: !!operation && applyCubeOperation(scene.state, operation) !== scene.state, apply: () => !!operation && apply([operation]) }; },
      };
    },
    onSelect: activeMove.onSelect,
    onPreview: (frame) => {
      const ids = frame ? idsForTarget(frame.target.pose.id) : [];
      setHandleFrame(frame ? { frame, source: scene.state, ids, interaction: activeMove } : null);
      previewPositions(frame ? new Map(scene.state.cubes.map((cube) => [cube.id, ids.includes(cube.id) ? spatialGizmoPoint(frame, cubeDisplayPosition(cube)) : cubeDisplayPosition(cube)])) : null);
    }, onDragging: setHandleDragging, onUnavailable: activeMove.onUnavailable,
  }) : undefined;
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
      {activeMove && (!moving || handleFrame) && <CubeMoveHandles interaction={{ ...activeMove, enabled: !moving && !handleDragging && !props.readOnly,
        bodyGesture: handleInteraction, bodyPreview: handleFrame?.frame, showHandles: transformMode === "move" && activeMove.showHandles === true && !handleFrame && !rollInteraction }} presentation={presentation} preview={dragPreview} onPreview={previewDrag} />}
      {transformMode === "rotate" && rotationInteraction && rotationPivot && !dragPreview && !handleFrame && <SpatialRotationControls center={rotationPivot} vertices={rotationVertices} moveHandles={toolbarHandles} action={{ ...rotationInteraction, disabled: rotationInteraction.disabled || moving,
        gestureLabel: onTransformOperations ? rotationInteraction.label : undefined }} />}
      {rollInteraction && rollCenter && !dragPreview && <SpatialRollControls center={rollCenter} vertices={unitCubeCorners(rolled)} moveHandles={toolbarHandles} action={{ ...rollInteraction, disabled: rollInteraction.disabled || moving }} />}
      {cutInteraction && !moving && <CubeCutPicker interaction={cutInteraction} />}
    </>} />;
}

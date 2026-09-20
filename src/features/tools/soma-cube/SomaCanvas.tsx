"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Html } from "@react-three/drei";
import { Quaternion, Vector3 } from "three";
import type { Axis } from "@/features/spatial-math/domain";
import { VoxelGeometry, VoxelModelCanvas } from "@/features/spatial-math/renderer-r3f/VoxelCanvas";
import type { VoxelRendererMessages } from "@/features/spatial-math/renderer-r3f/VoxelFallback";
import { CubeMoveHandles } from "../spatial-lab/CubeMoveHandles";
import type { CubeDragPreview } from "../spatial-lab/cube-structures-drag-controller";
import { cubeDragHandleAxis, cubeMoveCenter, type CubeMoveOperation } from "../spatial-lab/cube-structures-drag";
import { somaAnchorIndex, somaLocalCenter, somaRotationRadius, somaCubeState, somaDrag, somaDragPresentation, somaIdFromCell, somaRenderModel, somaVisiblePieces } from "./model";
import { SOMA_PIECES, somaDefinition, type SomaId } from "./pieces";
import type { SomaSnapshot } from "./contract";
import { somaRigidPoses } from "./motion";
import { interpolateRigidPoses } from "../spatial-interaction/rigid-motion";
import { useSpatialPresentation } from "../spatial-interaction/useSpatialPresentation";
import { spatialDirectManipulation } from "../spatial-interaction/policy";
import { SpatialRotationAnchor, SpatialRotationControls } from "../spatial-interaction/SpatialRotationControls";
import { CUBE_COLORS, CUBE_SELECTION_COLOR } from "../spatial-lab/cube-structures-contract";
import { somaMessages } from "./messages";
import { SpatialRollControls } from "../spatial-interaction/SpatialRollControls";
import type { SpatialRollAction } from "../spatial-interaction/SpatialRollButtons";
import type { SpatialMovePlane } from "../spatial-interaction/object-gesture-math";
import type { SpatialGestureTarget, SpatialObjectInteraction, SpatialObjectPreview } from "../spatial-interaction/object-gesture-controller";
import { somaGestureLanding } from "./manipulation";
import { spatialPickRigidCells } from "../spatial-interaction/rigid-geometry";
import { SpatialArcballGuide } from "../spatial-interaction/SpatialArcballGuide";
import { DEFAULT_SPATIAL_ROTATION_SNAP, type SpatialRotationSnapLevel } from "../spatial-interaction/rotation-snap";
import { SpatialLandingOutline } from "../spatial-interaction/SpatialLandingOutline";

const colors = Object.fromEntries(SOMA_PIECES.map((piece) => [piece.color, piece.color]));
export interface SomaCanvasProps {
  snapshot: SomaSnapshot; messages: VoxelRendererMessages; title: string; readOnly: boolean; axisSnap: boolean;
  navigation: "orbit" | "pan" | "move" | "rotate"; moveAxis: Axis; onMoveAxis: (axis: Axis) => void;
  onSelect: (id: SomaId) => void; onMove: (operation: CubeMoveOperation) => void; onUnavailable: () => void; onDragging: (value: boolean) => void;
  onRotate: (axis: Axis, turn: -1 | 1) => void; onMoving: (value: boolean) => void; instantKey?: string | null; locale: string;
  cameraInteractive?: boolean;
  rollAction?: SpatialRollAction;
  movePlane?: SpatialMovePlane; preciseAxes?: boolean; rotationAxis?: Axis; onRotationAxis?: (axis: Axis) => void;
  onPoseCommit?: (next: SomaSnapshot) => boolean; onPlaneUnavailable?: () => void; onGestureBlocked?: () => void;
  freeRotation?: boolean; rotationSnap?: SpatialRotationSnapLevel; onToggleRotation?: () => void;
}
export default function SomaCanvas({ snapshot, messages, title, readOnly, axisSnap, navigation, moveAxis, onMoveAxis, onSelect, onMove, onUnavailable, onDragging, onMoving, onRotate, instantKey, locale, rollAction, cameraInteractive = !readOnly,
  movePlane = "table", preciseAxes = false, rotationAxis = "y", onRotationAxis = onMoveAxis, onPoseCommit, onPlaneUnavailable = onUnavailable, onGestureBlocked = onUnavailable, freeRotation = true, rotationSnap = DEFAULT_SPATIAL_ROTATION_SNAP, onToggleRotation }: SomaCanvasProps) {
  const visible = useMemo(() => somaVisiblePieces(snapshot), [snapshot]);
  // 选择另一宝时只改变手柄目标；同一拼搭的命中几何保持身份，保留正在开始的拖动。
  const pieces = snapshot.mode === "assemble" ? snapshot.pieces : visible;
  const state = useMemo(() => somaCubeState(pieces), [pieces]);
  const [preview, setPreview] = useState<CubeDragPreview | null>(null);
  const [objectPreview, setObjectPreview] = useState<SpatialObjectPreview | null>(null);
  const [objectDragging, setObjectDragging] = useState(false);
  const presentation = useMemo(() => somaDragPresentation(state, preview), [state, preview]);
  const model = useMemo(() => somaRenderModel(state, snapshot, title, presentation), [state, presentation, snapshot, title]);
  const target = useMemo(() => somaRigidPoses(pieces), [pieces]);
  const motion = useSpatialPresentation({ target, key: JSON.stringify(target), interpolate: interpolateRigidPoses, instantKey });
  const shapes = useMemo(() => pieces.map((piece) => {
    const canonicalPiece = { id: piece.id, orientation: 0, position: { x: 0, y: 0, z: 0 } };
    const canonical = somaCubeState([canonicalPiece]);
    return { id: piece.id, model: somaRenderModel(canonical, { ...snapshot, pieces: [canonicalPiece] }, title) };
  }), [pieces, snapshot, title]);
  const direct = (spatialDirectManipulation(navigation) || navigation === "rotate") && snapshot.mode === "assemble";
  const selectedIds = state.cubes.filter((cube) => somaIdFromCell(cube.id) === snapshot.selectedId).map((cube) => cube.id);
  const selectedPose = motion.value.find((pose) => pose.id === snapshot.selectedId);
  const points = selectedPose ? somaDefinition(snapshot.selectedId).cells.map((p) => new Vector3(p.x, p.y, p.z).applyQuaternion(new Quaternion(...selectedPose.quaternion))
    .add(new Vector3(selectedPose.position.x, selectedPose.position.y, selectedPose.position.z))) : [];
  const middle = (axis: Axis) => (Math.min(...points.map((p) => p[axis])) + Math.max(...points.map((p) => p[axis]))) / 2;
  const center = points.length ? { x: middle("x"), y: middle("y"), z: middle("z") } : null;
  const localPivot = (id: SomaId) => freeRotation ? somaLocalCenter(id) : somaDefinition(id).cells[somaAnchorIndex(id)];
  const anchorCell = localPivot(snapshot.selectedId);
  const pivotVector = selectedPose ? new Vector3(anchorCell.x, anchorCell.y, anchorCell.z).applyQuaternion(new Quaternion(...selectedPose.quaternion)).add(new Vector3(selectedPose.position.x, selectedPose.position.y, selectedPose.position.z)) : null;
  const pivot = pivotVector ? { x: pivotVector.x, y: pivotVector.y, z: pivotVector.z } : null;
  useEffect(() => { onMoving(motion.animating); }, [motion.animating, onMoving]);
  useEffect(() => () => onMoving(false), [onMoving]);
  const dragging = preview !== null || objectDragging;
  useEffect(() => { onDragging(dragging); }, [dragging, onDragging]);
  useEffect(() => () => onDragging(false), [onDragging]);
  const selectCell = useCallback((cell: string) => { const id = somaIdFromCell(cell); if (id) onSelect(id); }, [onSelect]);
  const targetFor = (id: SomaId): SpatialGestureTarget | null => {
    const pose = target.find((pose) => pose.id === id); if (!pose) return null;
    const local = localPivot(id);
    const v = new Vector3(local.x, local.y, local.z).applyQuaternion(new Quaternion(...pose.quaternion)).add(new Vector3(pose.position.x, pose.position.y, pose.position.z));
    const pivot = { x: v.x, y: v.y, z: v.z };
    return { pose, pivot, grabPoint: pivot, radius: somaRotationRadius(id) };
  };
  const handleAxes: readonly Axis[] = navigation === "rotate" ? [] : preciseAxes || !onPoseCommit ? ["x", "y", "z"] : ["y"];
  const bodyGesture: SpatialObjectInteraction | undefined = onPoseCommit ? {
    key: state, enabled: !readOnly && !motion.animating && !preview, plane: movePlane, rotate: navigation === "rotate", selected: targetFor(snapshot.selectedId),
    pick: (raycaster) => {
      const hits = target.flatMap((pose) => {
        const hit = spatialPickRigidCells(raycaster.ray, pose, somaDefinition(pose.id as SomaId).cells);
        return hit ? [{ ...hit, id: pose.id as SomaId }] : [];
      }).sort((a, b) => a.distance - b.distance);
      const hit = hits[0], selected = hit && targetFor(hit.id);
      return selected ? { ...selected, grabPoint: hit.point } : null;
    },
    handlesHit: (event, camera, size) => {
      if (event.shiftKey || navigation === "rotate") return false;
      const center = cubeMoveCenter(state, selectedIds);
      return !!center && !!cubeDragHandleAxis({ x: event.clientX - size.left, y: event.clientY - size.top }, center, camera, size, handleAxes, event.pointerType === "touch" ? 22 : 12);
    },
    resolve: (selected, pose, action) => {
      const landing = somaGestureLanding(snapshot, selected.pose.id as SomaId, pose, action, freeRotation, rotationSnap);
      return { ...landing, apply: () => JSON.stringify(landing.snapshot) === JSON.stringify(snapshot) || onPoseCommit(landing.snapshot) };
    },
    onPreview: setObjectPreview, onDragging: setObjectDragging, onSelect: (id) => onSelect(id as SomaId),
    onUnavailable: (reason) => reason === "plane" ? onPlaneUnavailable() : onGestureBlocked(),
  } : undefined;
  const ghost = objectPreview?.phase === "drag" && (!freeRotation || !objectPreview.arcball || objectPreview.snapped) ? shapes.find((shape) => shape.id === objectPreview.target.pose.id) : null;
  const activeAnchor = objectPreview && localPivot(objectPreview.pose.id as SomaId);
  const activePivot = objectPreview && activeAnchor ? new Vector3(activeAnchor.x, activeAnchor.y, activeAnchor.z).applyQuaternion(new Quaternion(...objectPreview.pose.quaternion))
    .add(new Vector3(objectPreview.pose.position.x, objectPreview.pose.position.y, objectPreview.pose.position.z)) : null;
  return <VoxelModelCanvas model={{ ...model, cells: [] }} messages={messages} materialColors={colors} preserveSelectedColors
    cameraRequestKey={snapshot.cameraRevision} axisSnapEnabled={axisSnap} readOnly={readOnly} cameraInteractive={cameraInteractive}
    navigationMode={navigation === "move" && snapshot.mode === "assemble" ? "object" : navigation === "pan" ? "pan" : "orbit"}
    sceneOverlay={<>
      {motion.value.map((originalPose) => {
        const pose = objectPreview?.target.pose.id === originalPose.id ? objectPreview.pose : originalPose;
        const shape = shapes.find((shape) => shape.id === pose.id); if (!shape) return null;
        const cube = state.cubes.find((cube) => somaIdFromCell(cube.id) === pose.id);
        const presented = cube && presentation.cubes.find((item) => item.id === cube.id);
        const offset = cube && presented ? { x: presented.position.x - cube.position.x, y: presented.position.y - cube.position.y, z: presented.position.z - cube.position.z } : { x: 0, y: 0, z: 0 };
        return <group key={pose.id} name={`soma-rigid:${pose.id}`} position={[pose.position.x + offset.x, pose.position.y + offset.y, pose.position.z + offset.z]} quaternion={pose.quaternion}>
          <VoxelGeometry model={shape.model} palette={{ leaf: CUBE_COLORS[0], moon: CUBE_SELECTION_COLOR }} materialColors={colors} preserveSelectedColors
            readOnly={readOnly || direct || motion.animating} onCellSelect={selectCell} />
        </group>;
      })}
      {ghost && objectPreview && <group name="soma-landing-preview" position={[objectPreview.landing.position.x, objectPreview.landing.position.y, objectPreview.landing.position.z]} quaternion={objectPreview.landing.quaternion}>
        <SpatialLandingOutline cells={ghost.model.cells} color={objectPreview.valid ? CUBE_COLORS[0] : CUBE_SELECTION_COLOR} />
      </group>}
      {activePivot && <SpatialRotationAnchor center={activePivot} />}
      {objectPreview?.arcball && <SpatialArcballGuide ball={objectPreview.arcball} />}
      {snapshot.grid && <gridHelper args={[25, 25, "#b8b0a3", "#d9d3c8"]} position={[0, -0.505, 0]} raycast={() => null} />}
      {snapshot.axes && <axesHelper args={[3]} position={[-0.5, -0.5, -0.5]} raycast={() => null} />}
      {snapshot.labels && !motion.animating && pieces.filter((piece) => (!direct || piece.id !== snapshot.selectedId) && piece.id !== objectPreview?.pose.id).map((piece) => {
        const cells = presentation.cubes.filter((cube) => somaIdFromCell(cube.id) === piece.id);
        const center = (axis: Axis) => (Math.min(...cells.map((cube) => cube.position[axis])) + Math.max(...cells.map((cube) => cube.position[axis]))) / 2;
        return <Html key={piece.id} position={[center("x"), Math.max(...cells.map((cube) => cube.position.y)) + 0.85, center("z")]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
          <span className="whitespace-nowrap rounded bg-paper/90 px-1.5 py-0.5 text-xs text-ink">{somaDefinition(piece.id).name}</span>
        </Html>;
      })}
      {direct && <CubeMoveHandles presentation={presentation} preview={preview} onPreview={setPreview}
        interaction={{ state, ids: selectedIds, scopeIds: state.cubes.map((cube) => cube.id), bodyAxis: onPoseCommit ? "handles" : "gesture", handleAxes,
          enabled: !readOnly && !motion.animating && !objectDragging, continuousPreview: !!onPoseCommit, bodyGesture, showHandles: !objectPreview && !readOnly && !motion.animating,
          idsForHit: (id) => state.cubes.filter((cube) => somaIdFromCell(cube.id) === somaIdFromCell(id)).map((cube) => cube.id),
          axis: moveAxis, kind: "move", snapToGrid: true, isValidOperation: (operation) => somaDrag(snapshot, operation) !== null,
          onAxisChange: onMoveAxis, onSelect: selectCell, onCommit: onMove, onUnavailable }} />}
      {direct && !readOnly && center && !preview && !objectPreview && (rollAction
        ? <SpatialRollControls center={center} action={{ ...rollAction, disabled: rollAction.disabled || motion.animating }} />
        : <SpatialRotationControls center={onPoseCommit && pivot ? pivot : center} action={{ axis: rotationAxis, onAxisChange: onRotationAxis, onRotate, label: somaMessages(locale).rotate, disabled: motion.animating,
          gestureLabel: onPoseCommit ? somaMessages(locale).rotateDrag : undefined, precise: !onPoseCommit || navigation === "rotate",
          gestureMode: onToggleRotation ? { active: navigation === "rotate", onToggle: onToggleRotation } : undefined }} />)}
    </>} />;
}

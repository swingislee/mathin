"use client";

import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { THREE_SHADOWS } from "@/lib/three-runtime";
import { SpatialCameraRig } from "@/features/spatial-math/renderer-r3f/SpatialCameraRig";
import type { Axis } from "@/features/spatial-math/domain";
import { CubeMoveHandles } from "../spatial-lab/CubeMoveHandles";
import type { CubeDragPreview } from "../spatial-lab/cube-structures-drag-controller";
import type { CubeMoveOperation } from "../spatial-lab/cube-structures-drag";
import { cubeWorkbenchCamera } from "../spatial-lab/cube-workbench-camera";
import { CUBE_AXIS_COLORS, CUBE_COLORS, type CubeFrame } from "../spatial-lab/cube-structures-contract";
import { solidEntitySchema, type SolidEntity, type SolidGeometryInitial } from "./solid-geometry-contract";
import { SolidGeometryScene, type SolidGeometrySceneProps } from "./SolidGeometryScene";
import { moveSolidByDrag, solidDragState } from "./solid-geometry-drag";
import { SolidSectionHandles } from "../solid-sections/SolidSectionHandles";
import type { SolidSectionSettings } from "../solid-sections/solid-sections-contract";
import { SpatialRotationControls, type SpatialRotationAction } from "../spatial-interaction/SpatialRotationControls";
import { getSolidBounds } from "./solid-geometry";
import { SpatialRollControls } from "../spatial-interaction/SpatialRollControls";
import type { SpatialRollAction } from "../spatial-interaction/SpatialRollButtons";
import { spatialGizmoEuler, spatialGizmoInteraction, spatialGizmoPoint, snapSpatialTranslation } from "../spatial-interaction/gizmo-adapter";
import type { SpatialObjectPreview } from "../spatial-interaction/object-gesture-controller";
import { spatialQuarterTurn } from "../spatial-interaction/rigid-motion";

const ignoreTransition = () => {};
const ignoreRaycast = () => null;
class SolidCanvasBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p role="alert" className="p-8 text-sm">{this.props.label}</p> : this.props.children; }
}
export interface SolidGeometryCanvasProps extends SolidGeometrySceneProps {
  state: SolidGeometryInitial; frame: CubeFrame; cameraRevision: number; axisSnap: boolean; moveSnap: boolean;
  navigationMode: "orbit" | "pan" | "move"; moveAxis: Axis; onMoveAxis: (axis: Axis) => void;
  onMove: (operation: CubeMoveOperation) => void; onDragging: (dragging: boolean) => void; fallback: string;
  sectionEditable?: boolean; sectionSettings?: SolidSectionSettings;
  onSectionPreview?: (settings: SolidSectionSettings | null) => void; onSectionCommit?: (settings: SolidSectionSettings) => void;
  onSectionDragging?: (dragging: boolean) => void;
  objectManipulation?: boolean; objectAnimating?: boolean; rotationAction?: SpatialRotationAction;
  cameraInteractive?: boolean;
  rollAction?: SpatialRollAction;
  onTransform?: (entity: SolidEntity) => boolean;
  rotationHandles?: boolean;
  onToggleRotationHandles?: () => void;
  onPointerMissed?: (event: MouseEvent) => void;
}
function Contents(props: SolidGeometryCanvasProps) {
  const [preview, setPreview] = useState<CubeDragPreview | null>(null);
  const [handleFrame, setHandleFrame] = useState<{ frame: SpatialObjectPreview; entities: readonly SolidEntity[] } | null>(null);
  const [handleDragging, setHandleDragging] = useState(false);
  const onDragging = props.onDragging;
  useEffect(() => { onDragging(preview !== null || handleDragging); }, [onDragging, preview, handleDragging]);
  useEffect(() => () => onDragging(false), [onDragging]);
  const displayed = useMemo(() => handleFrame ? handleFrame.entities.map((entity) => entity.id === handleFrame.frame.target.pose.id ? { ...entity,
    position: spatialGizmoPoint(handleFrame.frame, entity.position), rotation: spatialGizmoEuler(handleFrame.frame, entity.rotation),
  } : entity) : preview ? props.entities.map((entity) => ({ ...entity, position: preview.positions.get(entity.id) ?? entity.position })) : props.entities, [props.entities, preview, handleFrame]);
  const dragState = useMemo(() => solidDragState(props.state.entities), [props.state.entities]);
  const dragPresentation = useMemo(() => solidDragState(displayed), [displayed]);
  const bookmark = cubeWorkbenchCamera(props.frame, props.state.view === "bottom" ? "top" : props.state.view, "solid-geometry");
  const camera = props.state.view === "bottom" ? { ...bookmark, position: { ...props.frame.center, y: props.frame.center.y - props.frame.radius * 4 }, up: { x: 0, y: 0, z: 1 } } : bookmark;
  const sectionEntity = props.state.entities.find((entity) => entity.id === props.selectedId);
  const rotationEntity = props.selectionActive === false ? undefined : displayed.find((entity) => entity.id === props.selectedId);
  const bounds = rotationEntity && getSolidBounds(rotationEntity);
  const source = props.state.entities.find((entity) => entity.id === props.selectedId);
  const handleInteraction = props.selectionActive !== false && props.onTransform && source ? spatialGizmoInteraction({ key: props.state.entities, id: source.id, center: source.position,
    radius: (bounds?.radius ?? 1) + 0.35, mode: props.rotationHandles ? "rotate" : "move", enabled: !props.readOnly && !props.objectAnimating && !preview && !props.rollAction,
    translate: (delta) => {
      const snapped = snapSpatialTranslation(delta, props.moveSnap ? 1 : 0.5, props.moveSnap ? source.position : undefined), next = { ...source, position: { x: source.position.x + snapped.x, y: source.position.y + snapped.y, z: source.position.z + snapped.z } };
      return { delta: snapped, valid: solidEntitySchema.safeParse(next).success, apply: () => props.onTransform!(next) };
    },
    rotate: (axis, turn) => { const next = { ...source, rotation: spatialQuarterTurn(source.rotation, axis, turn) }; return { valid: solidEntitySchema.safeParse(next).success, apply: () => props.onTransform!(next) }; },
    onPreview: (frame) => setHandleFrame(frame ? { frame, entities: props.entities } : null), onDragging: setHandleDragging, onUnavailable: ignoreTransition,
  }) : undefined;
  const toolbarVertices = bounds ? [bounds.min.x, bounds.max.x].flatMap((x) => [bounds.min.y, bounds.max.y].flatMap((y) => [bounds.min.z, bounds.max.z].map((z) => ({ x, y, z })))) : [];
  return <>
    <SpatialCameraRig bookmark={camera} radius={props.frame.radius} requestKey={props.cameraRevision} interactive={props.cameraInteractive ?? !props.readOnly}
      navigationMode={props.navigationMode === "pan" ? "pan" : "orbit"} axisSnapEnabled={props.axisSnap} onTransitionStateChange={ignoreTransition} />
    <ambientLight intensity={1.5} /><directionalLight position={[4, 7, 5]} intensity={2.1} /><directionalLight position={[-4, -3, -5]} intensity={1.0} />
    {props.state.grid && <gridHelper args={[24, 24, CUBE_COLORS[5], CUBE_COLORS[5]]} raycast={ignoreRaycast} />}
    {props.state.axes && <group><axesHelper args={[3]} raycast={ignoreRaycast} />{(["x", "y", "z"] as const).map((axis) => <Html key={axis} center position={axis === "x" ? [3.2, 0, 0] : axis === "y" ? [0, 3.2, 0] : [0, 0, 3.2]} style={{ pointerEvents: "none" }}><span className="text-xs" style={{ color: CUBE_AXIS_COLORS[axis] }}>{axis.toUpperCase()}</span></Html>)}</group>}
    <SolidGeometryScene {...props} entities={displayed} readOnly={props.readOnly || preview !== null} />
    {props.onSectionCommit && <SolidSectionHandles interaction={props.sectionEditable && !props.readOnly && sectionEntity ? { entity: sectionEntity, settings: props.state.section, onCommit: props.onSectionCommit } : null}
      displayed={props.sectionSettings ?? props.state.section} locale={props.locale ?? "zh"} onPreview={props.onSectionPreview ?? ignoreTransition} onDragging={props.onSectionDragging ?? ignoreTransition} />}
    {props.objectManipulation && ((!props.objectAnimating && !props.readOnly) || handleFrame) && props.selectedId && <CubeMoveHandles presentation={dragPresentation} preview={preview} onPreview={setPreview} pickRenderedObjects
      interaction={{ state: dragState, ids: [props.selectedId], scopeIds: props.state.entities.map((entity) => entity.id), axis: props.moveAxis, kind: "display-move", snapToGrid: props.moveSnap,
        bodyAxis: "gesture", enabled: !props.readOnly && !props.objectAnimating && !handleDragging, bodyGesture: handleInteraction, bodyPreview: handleFrame?.frame,
        showHandles: props.selectionActive !== false && !handleFrame && !props.rotationHandles && !props.rollAction,
        isValidOperation: (operation) => moveSolidByDrag(props.state.entities, operation) !== null, onAxisChange: props.onMoveAxis,
        onSelect: (id) => props.onPick?.(id, null), onCommit: props.onMove, onUnavailable: ignoreTransition }} />}
    {props.objectManipulation && !props.rollAction && props.rotationAction && rotationEntity && !preview && !handleFrame && <SpatialRotationControls center={rotationEntity.position} vertices={toolbarVertices} radius={bounds!.radius}
      action={{ ...props.rotationAction, disabled: props.readOnly || props.objectAnimating, gestureLabel: props.onTransform ? props.rotationAction.label : undefined,
        gestureMode: props.onToggleRotationHandles ? { active: !!props.rotationHandles, onToggle: props.onToggleRotationHandles } : undefined }} />}
    {props.objectManipulation && props.rollAction && rotationEntity && !preview && <SpatialRollControls center={rotationEntity.position} vertices={toolbarVertices} radius={bounds!.radius}
      action={{ ...props.rollAction, disabled: props.rollAction.disabled || props.readOnly || props.objectAnimating }} />}
  </>;
}
export default function SolidGeometryCanvas(props: SolidGeometryCanvasProps) {
  return <SolidCanvasBoundary label={props.fallback}><Canvas frameloop="demand" shadows={THREE_SHADOWS.disabled} dpr={[1, 1.75]}
    onPointerMissed={props.readOnly ? undefined : props.onPointerMissed}
    gl={{ antialias: true, alpha: true, localClippingEnabled: true }} fallback={<p className="p-8 text-sm">{props.fallback}</p>} style={{ touchAction: "none" }}>
    <Contents {...props} />
  </Canvas></SolidCanvasBoundary>;
}

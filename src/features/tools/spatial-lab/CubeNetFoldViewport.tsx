"use client";

import { useCallback, useEffect, useMemo, useRef, type ComponentRef } from "react";
import { Html, Line, type OrbitControls } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Vector3 } from "three";
import type { SpatialScene } from "@/features/spatial-math/domain";
import { PolyhedronFoldCanvas, type PolyhedronFoldRendererMessages } from "@/features/spatial-math/renderer-r3f/PolyhedronFoldCanvas";
import type { PolyhedronFoldRenderFace, PolyhedronFoldRenderModel } from "@/features/spatial-math/renderer-r3f/polyhedron-fold-render-model";
import { CUBE_AXIS_COLORS, CUBE_SELECTION_COLOR } from "./cube-structures-contract";
import { beginCubeNetPaperDrag, finishCubeNetFoldDrag, updateCubeNetFoldDrag, type CubeNetPaperDrag, type CubeNetPaperSelection, type CubeNetFoldChange } from "./cube-net-fold-drag";
import type { CubeNetWorkbenchHinge } from "./cube-net-workbench-model";
import type { CubeNetCutEdge } from "./cube-net-cutting";
import { CubeNetCutInteraction } from "./CubeNetCutInteraction";
import { CubeNetFaceArrows } from "./CubeNetFaceArrows";
import type { CubeNetRevealFace } from "./cube-net-face-reveal";

type FoldCameraControls = ComponentRef<typeof OrbitControls>;

export interface CubeNetFoldViewportProps {
  readonly scene: SpatialScene;
  readonly entityId: string;
  readonly model: PolyhedronFoldRenderModel;
  readonly hinges: readonly CubeNetWorkbenchHinge[];
  readonly activeEdgeId: string | null;
  readonly tool: "orbit" | "pan" | "fold" | "cut";
  readonly locale: "zh" | "en";
  readonly axisSnapEnabled: boolean;
  readonly axesVisible: boolean;
  readonly cameraRequestKey: number;
  readonly dragging: boolean;
  readonly foldingEnabled?: boolean;
  readonly animating?: boolean;
  readonly cutEdges?: readonly CubeNetCutEdge[];
  readonly onCutToggle?: (edgeId: string) => void;
  readonly onCutFaceOpen?: (faceId: string) => void;
  readonly faceArrows?: readonly CubeNetRevealFace[];
  readonly onFaceMove?: (faceId: string) => void;
  readonly messages: PolyhedronFoldRendererMessages;
  readonly onFoldStart: (selection: CubeNetPaperSelection) => void;
  readonly onPreview: (value: CubeNetFoldChange | null) => void;
  readonly onCommit: (value: CubeNetFoldChange) => void;
  readonly onDraggingChange: (dragging: boolean) => void;
}

function PickPaper({ face, onPointerDown }: { readonly face: PolyhedronFoldRenderFace; readonly onPointerDown: (event: ThreeEvent<PointerEvent>) => void }) {
  const geometry = useMemo(() => {
    const result = new BufferGeometry();
    result.setAttribute("position", new Float32BufferAttribute(face.trianglePositions, 3));
    return result;
  }, [face.trianglePositions]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} onPointerDown={onPointerDown}>
    <meshBasicMaterial side={DoubleSide} colorWrite={false} depthWrite={false} />
  </mesh>;
}

export function CubeNetFoldInteraction({ model, hinges, activeEdgeId, tool, foldingEnabled = true, onPreview, onCommit, onFoldStart, onDraggingChange }: CubeNetFoldViewportProps) {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const getThree = useThree((state) => state.get);
  const drag = useRef<{
    pointerId: number; gesture: CubeNetPaperDrag; degrees: number; moved: boolean;
    controls: FoldCameraControls | null; controlsEnabled: boolean;
  } | null>(null);
  const finish = useCallback((cancel: boolean) => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    if (canvas.hasPointerCapture(active.pointerId)) canvas.releasePointerCapture(active.pointerId);
    if (active.controls) active.controls.enabled = active.controlsEnabled;
    if (cancel || !active.moved) onPreview(null);
    else onCommit({ edgeId: active.gesture.edgeId, degrees: finishCubeNetFoldDrag(active.degrees), anchor: active.gesture.anchor });
    onDraggingChange(false);
  }, [canvas, onCommit, onDraggingChange, onPreview]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      event.preventDefault();
      const degrees = updateCubeNetFoldDrag(active.gesture, { x: event.clientX, y: event.clientY }, active.degrees);
      active.moved ||= degrees !== active.gesture.initialAngle;
      if (degrees !== active.degrees) {
        active.degrees = degrees;
        onPreview({ edgeId: active.gesture.edgeId, degrees, anchor: active.gesture.anchor });
      }
    };
    const up = (event: PointerEvent) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      move(event);
      finish(false);
    };
    const cancelPointer = (event: PointerEvent) => { if (drag.current?.pointerId === event.pointerId) finish(true); };
    const cancel = () => finish(true);
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", cancelPointer);
    canvas.addEventListener("lostpointercapture", cancelPointer);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key);
    return () => {
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", cancelPointer);
      canvas.removeEventListener("lostpointercapture", cancelPointer);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key);
      const active = drag.current;
      drag.current = null;
      if (active && canvas.hasPointerCapture(active.pointerId)) canvas.releasePointerCapture(active.pointerId);
      if (active?.controls) active.controls.enabled = active.controlsEnabled;
    };
  }, [canvas, finish, onPreview]);
  useEffect(() => { if (tool !== "fold") finish(true); }, [finish, tool]);

  const grab = (face: PolyhedronFoldRenderFace, event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (event.button !== 0 || event.isPrimary === false || drag.current) return;
    const rect = canvas.getBoundingClientRect();
    const gesture = beginCubeNetPaperDrag(face, model.faces, hinges, event.point, { x: event.clientX, y: event.clientY }, (point) => {
      const projected = new Vector3(point.x, point.y, point.z).project(camera);
      return { x: rect.left + (projected.x + 1) * rect.width / 2, y: rect.top + (1 - projected.y) * rect.height / 2 };
    });
    if (!gesture) return;
    const controls = getThree().controls as FoldCameraControls | null;
    drag.current = { pointerId: event.pointerId, gesture, degrees: gesture.initialAngle, moved: false,
      controls, controlsEnabled: controls?.enabled ?? false };
    // 原生相机事件与 R3F 共用画布；在本次按下立即锁住相机，避免等待 React 更新时混入旋转。
    if (controls) controls.enabled = false;
    canvas.setPointerCapture(event.pointerId);
    onFoldStart({ edgeId: gesture.edgeId, faceId: gesture.faceId, movingFaceIds: gesture.movingFaceIds, anchor: gesture.anchor });
    onDraggingChange(true);
  };

  return <>
    {tool === "fold" && foldingEnabled && model.faces.map((face) => <PickPaper key={face.faceId} face={face} onPointerDown={(event) => grab(face, event)} />)}
    {hinges.map((hinge) => <group key={hinge.edgeId} renderOrder={7}>
      {hinge.edgeId === activeEdgeId && <Line
        points={[[hinge.start.x, hinge.start.y, hinge.start.z], [hinge.end.x, hinge.end.y, hinge.end.z]]}
        color={CUBE_SELECTION_COLOR} lineWidth={3}
        depthTest={false} depthWrite={false} raycast={() => null} />}
    </group>)}
  </>;
}

function NetAxes({ model }: { readonly model: PolyhedronFoldRenderModel }) {
  const length = Math.max(3, model.bounds.radius * 1.5);
  return <group>{(["x", "y", "z"] as const).map((axis) => {
    const end = { x: 0, y: 0, z: 0, [axis]: length };
    return <group key={axis}>
      <Line points={[[0, 0, 0], [end.x, end.y, end.z]]} color={CUBE_AXIS_COLORS[axis]} lineWidth={2} raycast={() => null} />
      <Html position={[end.x, end.y, end.z]} center zIndexRange={[3, 0]} style={{ pointerEvents: "none" }}>
        <span className="rounded bg-paper/90 px-1 text-xs font-bold" style={{ color: CUBE_AXIS_COLORS[axis] }}>{axis.toUpperCase()}</span>
      </Html>
    </group>;
  })}</group>;
}

function CubeNetPlaybackFrames({ active }: { readonly active: boolean }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => { if (active) invalidate(); }, [active, invalidate]);
  useFrame(() => { if (active) invalidate(); });
  return null;
}

export function CubeNetFoldViewport(props: CubeNetFoldViewportProps) {
  return <PolyhedronFoldCanvas scene={props.scene} entityId={props.entityId} progress={0} locale={props.locale}
    doubleSidedLabels
    renderModelOverride={props.model} cameraRequestKey={props.cameraRequestKey} axisSnapEnabled={props.axisSnapEnabled}
    navigationMode={props.tool === "pan" ? "pan" : "orbit"} cameraInteractive={!props.dragging}
    messages={props.messages} materialColors={{ "solid.primary": "#8fbf88" }}
    sceneChildren={<><CubeNetPlaybackFrames active={!!props.animating} /><CubeNetFoldInteraction {...props} />
      {props.cutEdges && <CubeNetCutInteraction model={props.model} edges={props.cutEdges} onToggle={props.onCutToggle} onOpen={props.onCutFaceOpen} blockFaces={!!props.onCutToggle || !!props.faceArrows} />}
      {props.faceArrows && <CubeNetFaceArrows faces={props.faceArrows} onMove={props.onFaceMove} />}
      {props.axesVisible && <NetAxes model={props.model} />}</>} />;
}

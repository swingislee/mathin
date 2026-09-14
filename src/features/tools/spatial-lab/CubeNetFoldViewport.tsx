"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Html, Line } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Quaternion, Vector3 } from "three";
import type { SpatialScene } from "@/features/spatial-math/domain";
import { PolyhedronFoldCanvas, type PolyhedronFoldRendererMessages } from "@/features/spatial-math/renderer-r3f/PolyhedronFoldCanvas";
import type { PolyhedronFoldRenderFace, PolyhedronFoldRenderModel } from "@/features/spatial-math/renderer-r3f/polyhedron-fold-render-model";
import { CUBE_AXIS_COLORS, CUBE_SELECTION_COLOR } from "./cube-structures-contract";
import { beginCubeNetFoldDrag, finishCubeNetFoldDrag, updateCubeNetFoldDrag, type CubeNetFoldDrag } from "./cube-net-fold-drag";
import type { CubeNetWorkbenchHinge } from "./cube-net-workbench-model";

export interface CubeNetFoldViewportProps {
  readonly scene: SpatialScene;
  readonly entityId: string;
  readonly model: PolyhedronFoldRenderModel;
  readonly hinges: readonly CubeNetWorkbenchHinge[];
  readonly selectedEdgeId: string | null;
  readonly angle: number;
  readonly tool: "orbit" | "pan" | "fold";
  readonly locale: "zh" | "en";
  readonly axisSnapEnabled: boolean;
  readonly axesVisible: boolean;
  readonly cameraRequestKey: number;
  readonly dragging: boolean;
  readonly messages: PolyhedronFoldRendererMessages;
  readonly onHingeSelect: (edgeId: string) => void;
  readonly onPreview: (value: { readonly edgeId: string; readonly degrees: number } | null) => void;
  readonly onCommit: (edgeId: string, degrees: number) => void;
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

function PickHinge({ hinge, onSelect }: { readonly hinge: CubeNetWorkbenchHinge; readonly onSelect: () => void }) {
  const start = new Vector3(hinge.start.x, hinge.start.y, hinge.start.z);
  const end = new Vector3(hinge.end.x, hinge.end.y, hinge.end.z);
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), end.clone().sub(start).normalize());
  return <mesh position={midpoint} quaternion={rotation} onPointerDown={(event) => {
    event.stopPropagation();
    if (event.button === 0 && event.isPrimary !== false) onSelect();
  }}>
    <cylinderGeometry args={[0.065, 0.065, start.distanceTo(end), 8]} />
    <meshBasicMaterial colorWrite={false} depthWrite={false} />
  </mesh>;
}

function FoldInteraction({ model, hinges, selectedEdgeId, tool, angle, onPreview, onCommit, onHingeSelect, onDraggingChange }: CubeNetFoldViewportProps) {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const drag = useRef<{ pointerId: number; gesture: CubeNetFoldDrag; degrees: number } | null>(null);
  const selected = hinges.find((hinge) => hinge.edgeId === selectedEdgeId);
  const finish = useCallback((cancel: boolean) => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    if (canvas.hasPointerCapture(active.pointerId)) canvas.releasePointerCapture(active.pointerId);
    if (cancel) onPreview(null);
    else onCommit(active.gesture.edgeId, finishCubeNetFoldDrag(active.degrees));
    onDraggingChange(false);
  }, [canvas, onCommit, onDraggingChange, onPreview]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      event.preventDefault();
      active.degrees = updateCubeNetFoldDrag(active.gesture, { x: event.clientX, y: event.clientY }, active.degrees);
      onPreview({ edgeId: active.gesture.edgeId, degrees: active.degrees });
    };
    const up = (event: PointerEvent) => { if (drag.current?.pointerId === event.pointerId) finish(false); };
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
    };
  }, [canvas, finish, onPreview]);
  useEffect(() => { if (tool !== "fold") finish(true); }, [finish, tool]);

  const grab = (face: PolyhedronFoldRenderFace, event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (!selected || !selected.movingFaceIds.includes(face.faceId) || event.button !== 0 || event.isPrimary === false || drag.current) return;
    const rect = canvas.getBoundingClientRect();
    const gesture = beginCubeNetFoldDrag(selected, event.point, angle, { x: event.clientX, y: event.clientY }, (point) => {
      const projected = new Vector3(point.x, point.y, point.z).project(camera);
      return { x: rect.left + (projected.x + 1) * rect.width / 2, y: rect.top + (1 - projected.y) * rect.height / 2 };
    });
    if (!gesture) return;
    drag.current = { pointerId: event.pointerId, gesture, degrees: angle };
    canvas.setPointerCapture(event.pointerId);
    onDraggingChange(true);
  };

  return <>
    {tool === "fold" && model.faces.map((face) => <PickPaper key={face.faceId} face={face} onPointerDown={(event) => grab(face, event)} />)}
    {hinges.map((hinge) => <group key={hinge.edgeId} renderOrder={7}>
      {(tool === "fold" || hinge.edgeId === selectedEdgeId) && <Line
        points={[[hinge.start.x, hinge.start.y, hinge.start.z], [hinge.end.x, hinge.end.y, hinge.end.z]]}
        color={CUBE_SELECTION_COLOR} lineWidth={hinge.edgeId === selectedEdgeId ? 6 : 2}
        dashed={hinge.edgeId !== selectedEdgeId} dashSize={0.1} gapSize={0.06}
        depthTest={false} depthWrite={false} raycast={() => null} />}
      {tool === "fold" && <PickHinge hinge={hinge} onSelect={() => onHingeSelect(hinge.edgeId)} />}
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

export function CubeNetFoldViewport(props: CubeNetFoldViewportProps) {
  return <PolyhedronFoldCanvas scene={props.scene} entityId={props.entityId} progress={0} locale={props.locale}
    doubleSidedLabels
    renderModelOverride={props.model} cameraRequestKey={props.cameraRequestKey} axisSnapEnabled={props.axisSnapEnabled}
    navigationMode={props.tool === "fold" ? "object" : props.tool} cameraInteractive={!props.dragging}
    messages={props.messages} materialColors={{ "solid.primary": "#8fbf88" }}
    sceneChildren={<><FoldInteraction {...props} />{props.axesVisible && <NetAxes model={props.model} />}</>} />;
}

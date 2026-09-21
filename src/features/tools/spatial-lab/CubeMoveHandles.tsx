"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { CUBE_AXIS_COLORS, type CubeStructureState } from "./cube-structures-contract";
import { CUBE_DRAG_AXES, CUBE_MOVE_HANDLE_LENGTH, cubeMoveCenter } from "./cube-structures-drag";
import { bindCubeAxisDrag, type CubeDragPreview, type CubeMoveInteraction } from "./cube-structures-drag-controller";
import { pickSpatialObject } from "../spatial-interaction/picking";
import { beginSpatialObjectGesture } from "@/features/spatial-math/renderer-r3f/spatial-object-gesture";
import { bindSpatialObjectGestures } from "../spatial-interaction/object-gesture-controller";
import { SpatialTransformHandles } from "../spatial-interaction/SpatialTransformHandles";

export function CubeMoveHandles({ interaction, presentation, preview, onPreview, pickRenderedObjects = false }: {
  readonly interaction: CubeMoveInteraction;
  readonly presentation: CubeStructureState;
  readonly preview: CubeDragPreview | null;
  readonly onPreview: (preview: CubeDragPreview | null) => void;
  readonly pickRenderedObjects?: boolean;
}) {
  const { gl, get } = useThree();
  const current = useRef(interaction);
  useLayoutEffect(() => { current.current = interaction; }, [interaction]);
  const hasBodyGesture = !!interaction.bodyGesture;
  useEffect(() => {
    const axis = bindCubeAxisDrag(gl.domElement, () => pickRenderedObjects ? { ...current.current, hitTest: (raycaster) => pickSpatialObject(raycaster, get().scene) } : current.current, () => get().camera, onPreview, (active) => {
      if (active) beginSpatialObjectGesture(gl.domElement);
    });
    const body = hasBodyGesture ? bindSpatialObjectGestures(gl.domElement, () => current.current.bodyGesture, () => get().camera) : null;
    return () => { axis(); body?.(); };
  }, [gl, get, onPreview, pickRenderedObjects, hasBodyGesture]);
  const center = cubeMoveCenter(presentation, preview?.ids ?? interaction.ids);
  const handles = interaction.bodyGesture?.handles;
  if (!center) return null;
  const length = CUBE_MOVE_HANDLE_LENGTH;
  return <group>
    {handles && (interaction.bodyGesture?.enabled || interaction.bodyPreview) && (!interaction.bodyPreview || interaction.bodyPreview.constraint) && <SpatialTransformHandles spec={handles} preview={interaction.bodyPreview} />}
    {(interaction.showHandles === false && !preview ? [] : interaction.handleAxes ?? CUBE_DRAG_AXES).map((axis) => {
      const end = { ...center, [axis]: center[axis] + length };
      const color = preview?.valid === false && axis === preview.axis ? CUBE_AXIS_COLORS.x : CUBE_AXIS_COLORS[axis];
      return <group key={axis}>
        <Line points={[[center.x, center.y, center.z], [end.x, end.y, end.z]]} color={color} lineWidth={axis === interaction.axis ? 4 : 2.5} depthTest={false} depthWrite={false} raycast={() => null} renderOrder={8} />
        <mesh position={[end.x, end.y, end.z]} rotation={axis === "x" ? [0, 0, -Math.PI / 2] : axis === "z" ? [Math.PI / 2, 0, 0] : [0, 0, 0]} raycast={() => null} renderOrder={8}>
          <coneGeometry args={[length * 0.055, length * 0.19, 12]} /><meshBasicMaterial color={color} depthTest={false} depthWrite={false} />
        </mesh>
        <Html position={[end.x, end.y, end.z]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}><span className="ml-6 rounded bg-paper/90 px-1 text-xs font-bold" style={{ color }}>{axis.toUpperCase()}</span></Html>
      </group>;
    })}
    {preview && <Html position={[center.x, center.y, center.z]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}><span className="mt-6 block whitespace-nowrap rounded bg-paper/95 px-2 py-1 text-xs font-bold text-ink">{preview.axis.toUpperCase()} {preview.distance > 0 ? "+" : ""}{preview.distance}{preview.valid ? "" : " ×"}</span></Html>}
  </group>;
}

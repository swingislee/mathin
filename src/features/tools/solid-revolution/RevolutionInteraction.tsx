"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Quaternion, Vector3 } from "three";
import { bindSpatialObjectGestures, type SpatialObjectInteraction, type SpatialObjectPreview } from "../spatial-interaction/object-gesture-controller";
import { pickSpatialObjectHit } from "../spatial-interaction/picking";
import type { SpatialRigidPose } from "../spatial-interaction/rigid-motion";
import { normalizeRevolutionAngle, revolutionDimensions } from "./model";
import type { SolidRevolutionCanvasProps } from "./SolidRevolutionCanvas";

const yAxis = new Vector3(0, 1, 0);
/** 使用有符号四元数保留整圈 360°，不把同一姿态误当零度。 */
export function revolutionGestureAngle(source: number, target: SpatialRigidPose, pose: SpatialRigidPose) {
  const relative = new Quaternion(...pose.quaternion).multiply(new Quaternion(...target.quaternion).invert()).normalize();
  const delta = 2 * Math.atan2(relative.y, relative.w) * 180 / Math.PI;
  return normalizeRevolutionAngle(source + delta);
}
export function RevolutionInteraction(props: SolidRevolutionCanvasProps) {
  const canvas = useThree((state) => state.gl.domElement), get = useThree((state) => state.get);
  const current = useRef<SpatialObjectInteraction | null>(null);
  useLayoutEffect(() => {
    const { snapshot } = props, dimensions = revolutionDimensions(snapshot);
    const pose: SpatialRigidPose = { id: "revolution-paper", position: { x: 0, y: 0, z: 0 }, quaternion: new Quaternion().setFromAxisAngle(yAxis, snapshot.angle * Math.PI / 180).toArray() };
    const angleFor = (target: SpatialRigidPose, next: SpatialRigidPose) => revolutionGestureAngle(snapshot.angle, target, next);
    current.current = {
      key: snapshot, enabled: props.gestureEnabled, plane: "table", freeRotation: false, selected: null,
      pick: (raycaster) => {
        const hit = pickSpatialObjectHit(raycaster, get().scene);
        return hit ? { pose, pivot: { x: 0, y: hit.point.y, z: 0 }, grabPoint: hit.point, radius: dimensions.radius } : null;
      },
      bodyConstraint: () => ({ kind: "axis-rotation", axis: "y", maxAngle: 2 * Math.PI }),
      resolve: (target, next) => {
        const angle = angleFor(target.pose, next);
        return { pose: { ...pose, quaternion: new Quaternion().setFromAxisAngle(yAxis, angle * Math.PI / 180).toArray() }, valid: true, apply: () => props.onCommit(angle) };
      },
      onPreview: (preview: SpatialObjectPreview | null) => props.onPreview(preview ? angleFor(preview.target.pose, preview.pose) : null),
      onDragging: (dragging) => { if (dragging) props.onSelect(); props.onDragging(dragging); },
      onSelect: props.onSelect, onUnavailable: props.onUnavailable,
    };
  }, [props, get]);
  useEffect(() => bindSpatialObjectGestures(canvas, () => current.current, () => get().camera), [canvas, get]);
  return null;
}

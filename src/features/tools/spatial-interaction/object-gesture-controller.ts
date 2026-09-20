import type { Camera, Raycaster } from "three";
import type { VoxelCoordinate } from "@/features/spatial-math/domain";
import { beginSpatialObjectGesture } from "@/features/spatial-math/renderer-r3f/spatial-object-gesture";
import { animateSpatialAction } from "./policy";
import { interpolateRigidPoses, type SpatialRigidPose } from "./rigid-motion";
import { spatialMoveDelta, spatialMoveProjection, spatialPointerRay, type SpatialMovePlane, type SpatialObjectAction, type SpatialPointerViewport } from "./object-gesture-math";
import { spatialArcball, spatialArcballRotation, type SpatialArcball } from "./arcball";

export interface SpatialGestureTarget { pose: SpatialRigidPose; pivot: VoxelCoordinate; grabPoint: VoxelCoordinate; radius?: number }
export interface SpatialGestureLanding { pose: SpatialRigidPose; valid: boolean; apply: () => boolean; snapped?: boolean }
export interface SpatialObjectPreview { target: SpatialGestureTarget; pose: SpatialRigidPose; landing: SpatialRigidPose; valid: boolean; phase: "drag" | "settle"; arcball?: SpatialArcball; snapped?: boolean }
export interface SpatialObjectInteraction {
  key: object; enabled: boolean; plane: SpatialMovePlane; rotate?: boolean;
  selected: SpatialGestureTarget | null;
  pick: (raycaster: Raycaster) => SpatialGestureTarget | null;
  handlesHit?: (event: PointerEvent, camera: Camera, size: SpatialPointerViewport) => boolean;
  resolve: (target: SpatialGestureTarget, pose: SpatialRigidPose, action: SpatialObjectAction) => SpatialGestureLanding;
  onPreview: (preview: SpatialObjectPreview | null) => void;
  onDragging: (active: boolean) => void;
  onSelect: (id: string) => void;
  onUnavailable: (reason: "plane" | "blocked") => void;
}
const ROTATE_GRIP = "mathin:object-rotate-grip";
const cameraHandoffs = new WeakSet<Event>();
export const isSpatialCameraHandoff = (event: Event) => cameraHandoffs.has(event);
export function startSpatialRotationGrip(canvas: HTMLCanvasElement, event: PointerEvent) {
  canvas.dispatchEvent(new CustomEvent(ROTATE_GRIP, { detail: event }));
}
export const SPATIAL_GESTURE_SETTLE_MS = 160;

/** 共用对象手势入口。数学落点由教具提供；相机、连续预览和一次提交不在各教具复制。 */
export function bindSpatialObjectGestures(canvas: HTMLCanvasElement, current: () => SpatialObjectInteraction, getCamera: () => Camera): () => void {
  type Gesture = { interaction: SpatialObjectInteraction; key: object; target: SpatialGestureTarget; action: SpatialObjectAction; camera: Camera; size: SpatialPointerViewport;
    start: PointerEvent; ball: SpatialArcball; projection: ReturnType<typeof spatialMoveProjection>; moved: boolean; frame: SpatialObjectPreview | null; landing: SpatialGestureLanding | null; cursor: string };
  let gesture: Gesture | null = null, settling: (() => void) | null = null;
  const cameraPointers = new Set<number>();
  const stop = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const stopSettle = () => { settling?.(); settling = null; };
  const release = () => {
    const previous = gesture; gesture = null;
    if (previous) {
      canvas.style.cursor = previous.cursor;
      if (canvas.hasPointerCapture(previous.start.pointerId)) canvas.releasePointerCapture(previous.start.pointerId);
    }
    return previous;
  };
  const finishPreview = (interaction: SpatialObjectInteraction) => { interaction.onPreview(null); interaction.onDragging(false); };
  const settle = (finished: Gesture, to: SpatialRigidPose) => {
    const from = finished.frame?.pose ?? finished.target.pose;
    // 自由旋转终点就是最后预览帧，不追加落位等待，也不重播已完成的手势。
    const samePosition = Math.hypot(from.position.x - to.position.x, from.position.y - to.position.y, from.position.z - to.position.z) < 1e-8;
    const dot = Math.abs(from.quaternion.reduce((sum, value, index) => sum + value * to.quaternion[index], 0));
    if (samePosition && dot > 1 - 1e-12) { finishPreview(finished.interaction); return; }
    settling = animateSpatialAction(SPATIAL_GESTURE_SETTLE_MS, (progress) => {
      if (progress === 1) { settling = null; finishPreview(finished.interaction); return; }
      finished.interaction.onPreview({ target: finished.target, pose: interpolateRigidPoses([from], [to], progress)[0], landing: to, valid: true, phase: "settle" });
    });
  };
  const cancel = (animate = true) => {
    const previous = release(); if (!previous) return;
    if (animate && previous.moved) settle(previous, previous.target.pose); else finishPreview(previous.interaction);
  };
  const start = (event: PointerEvent, forced = false) => {
    if (isSpatialCameraHandoff(event) || cameraPointers.size || settling) return;
    if (gesture) {
      if (event.pointerId === gesture.start.pointerId) return;
      if (!gesture.moved && gesture.start.pointerType === "touch" && event.pointerType === "touch") {
        // 单指尚未移动时加入第二指，重建完整的相机双指起点；不把第二指误当单指旋转。
        const first = gesture.start; cancel(false);
        cameraPointers.add(first.pointerId); cameraPointers.add(event.pointerId);
        const replay = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: first.pointerId, pointerType: "touch", isPrimary: true,
          clientX: first.clientX, clientY: first.clientY, button: 0, buttons: 1 });
        cameraHandoffs.add(replay); canvas.dispatchEvent(replay);
      } else stop(event); // 已开始的对象动作保持归属；额外触点不抢走操作。
      return;
    }
    const interaction = current();
    if (!interaction.enabled || event.button !== 0 || event.isPrimary === false) return;
    const camera = getCamera().clone(), size = canvas.getBoundingClientRect();
    if (!forced && interaction.handlesHit?.(event, camera, size)) return;
    const raycaster = spatialPointerRay({ x: event.clientX, y: event.clientY }, camera, size);
    const target = forced ? interaction.selected : interaction.pick(raycaster);
    if (!target) return;
    stop(event); stopSettle();
    const action: SpatialObjectAction = forced || event.shiftKey || interaction.rotate ? "rotate" : "translate";
    const projection = action === "translate" ? spatialMoveProjection({ x: event.clientX, y: event.clientY }, target.grabPoint, interaction.plane, camera, size) : null;
    // 侧看桌面仍允许轻点选择；达到起拖阈值时再提示不可解的移动平面。
    gesture = { interaction, key: interaction.key, target, action, camera, size, start: event,
      ball: spatialArcball(target.pivot, target.radius ?? 1, camera, size), projection, moved: false, frame: null, landing: null, cursor: canvas.style.cursor };
    canvas.setPointerCapture(event.pointerId); canvas.style.cursor = "grabbing";
    beginSpatialObjectGesture(canvas);
  };
  const move = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.start.pointerId) return;
    stop(event);
    const g = gesture;
    if (current().key !== g.key || !current().enabled) { cancel(false); return; }
    const delta = { x: event.clientX - g.start.clientX, y: event.clientY - g.start.clientY };
    if (!g.moved && Math.hypot(delta.x, delta.y) <= (g.start.pointerType === "touch" ? 8 : 3)) return;
    if (!g.moved) { g.moved = true; g.interaction.onDragging(true); }
    let pose = g.target.pose;
    if (g.action === "rotate") pose = spatialArcballRotation(pose, g.target.pivot, { x: g.start.clientX, y: g.start.clientY }, { x: event.clientX, y: event.clientY }, g.ball);
    else {
      const translation = g.projection && spatialMoveDelta(g.projection, { x: event.clientX, y: event.clientY }, g.camera, g.size);
      if (!translation) { g.interaction.onUnavailable("plane"); return; }
      pose = { ...pose, position: { x: pose.position.x + translation.x, y: pose.position.y + translation.y, z: pose.position.z + translation.z } };
    }
    g.landing = g.interaction.resolve(g.target, pose, g.action);
    g.frame = { target: g.target, pose, landing: g.landing.pose, valid: g.landing.valid, phase: "drag", arcball: g.action === "rotate" ? g.ball : undefined, snapped: g.landing.snapped };
    g.interaction.onPreview(g.frame);
  };
  const up = (event: PointerEvent) => {
    cameraPointers.delete(event.pointerId);
    if (!gesture || event.pointerId !== gesture.start.pointerId) return;
    move(event);
    const finished = release(); if (!finished) return;
    if (!finished.moved) { finishPreview(finished.interaction); finished.interaction.onSelect(finished.target.pose.id); return; }
    if (!finished.landing) { finishPreview(finished.interaction); return; }
    const accepted = finished.landing.valid && finished.landing.apply();
    if (!accepted) finished.interaction.onUnavailable("blocked");
    settle(finished, accepted ? finished.landing.pose : finished.target.pose);
  };
  const cancelled = (event: PointerEvent) => { cameraPointers.delete(event.pointerId); if (gesture?.start.pointerId === event.pointerId) { stop(event); cancel(); } };
  const lost = (event: PointerEvent) => { if (gesture?.start.pointerId === event.pointerId) cancel(); };
  const blur = () => { cameraPointers.clear(); cancel(); };
  const key = (event: KeyboardEvent) => { if (event.key === "Escape" && gesture) { stop(event); cancel(); } };
  const wheel = (event: WheelEvent) => { if (gesture) stop(event); };
  const grip = (event: Event) => start((event as CustomEvent<PointerEvent>).detail, true);
  const document = canvas.ownerDocument;
  canvas.addEventListener("pointerdown", start, true); // 由 CubeMoveHandles 先注册精确轴入口，再注册对象入口。
  canvas.addEventListener(ROTATE_GRIP, grip);
  canvas.addEventListener("lostpointercapture", lost);
  canvas.addEventListener("wheel", wheel, { capture: true, passive: false });
  document.addEventListener("pointermove", move, true);
  document.addEventListener("pointerup", up, true);
  document.addEventListener("pointercancel", cancelled, true);
  document.addEventListener("keydown", key, true);
  document.defaultView?.addEventListener("blur", blur);
  return () => {
    cancel(false); stopSettle(); finishPreview(current());
    canvas.removeEventListener("pointerdown", start, true); canvas.removeEventListener(ROTATE_GRIP, grip); canvas.removeEventListener("lostpointercapture", lost); canvas.removeEventListener("wheel", wheel, true);
    document.removeEventListener("pointermove", move, true); document.removeEventListener("pointerup", up, true); document.removeEventListener("pointercancel", cancelled, true);
    document.removeEventListener("keydown", key, true); document.defaultView?.removeEventListener("blur", blur);
  };
}

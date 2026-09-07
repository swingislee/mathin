import { Raycaster, Vector2, type Camera } from "three";
import type { Axis } from "@/features/spatial-math/domain";
import { applyCubeOperation, type CubeStructureState } from "./cube-structures-contract";
import { cubeDragDistance, cubeDragHandleAxis, cubeDragHit, cubeDragOperation, cubeDragPositions, cubeDragProjection, cubeMoveCenter, type CubeMoveOperation, type CubeScreenPoint } from "./cube-structures-drag";
import type { CubeDisplayPositions } from "./cube-structures-motion";

export interface CubeDragPreview {
  readonly positions: CubeDisplayPositions;
  readonly axis: Axis;
  readonly distance: number;
  readonly valid: boolean;
}
export interface CubeMoveInteraction {
  readonly state: CubeStructureState;
  readonly ids: readonly string[];
  readonly scopeIds: readonly string[];
  readonly axis: Axis;
  readonly kind: CubeMoveOperation["kind"];
  readonly onAxisChange: (axis: Axis) => void;
  readonly onSelect: (id: string) => void;
  readonly onCommit: (operation: CubeMoveOperation) => void;
  readonly onUnavailable: () => void;
}

/** 一次指针手势只在松手写入终点；捕获、取消和预览均局限在当前画布。 */
export function bindCubeAxisDrag(canvas: HTMLCanvasElement, getInteraction: () => CubeMoveInteraction, getCamera: () => Camera, onPreview: (preview: CubeDragPreview | null) => void, onGesture?: (active: boolean) => void) {
  type Gesture = { snapshot: CubeMoveInteraction; pointerId: number; start: CubeScreenPoint; projection: CubeScreenPoint; ids: readonly string[]; axis: Axis; hit: string | null; dragged: boolean; distance: number; cursor: string };
  let gesture: Gesture | null = null;
  let frame = 0;
  let pending: CubeDragPreview | null = null;
  const raycaster = new Raycaster();
  const stop = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const clear = () => {
    const previous = gesture;
    gesture = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0; pending = null;
    if (previous) {
      canvas.style.cursor = previous.cursor;
      if (canvas.hasPointerCapture(previous.pointerId)) canvas.releasePointerCapture(previous.pointerId);
      onPreview(null);
      onGesture?.(false);
    }
    return previous;
  };
  const down = (event: PointerEvent) => {
    if (gesture) { clear(); return; }
    if (event.button !== 0 || event.isPrimary === false) return;
    const snapshot = getInteraction();
    const camera = getCamera();
    const size = canvas.getBoundingClientRect();
    const point = { x: event.clientX - size.left, y: event.clientY - size.top };
    const center = cubeMoveCenter(snapshot.state, snapshot.ids);
    if (!center) return;
    const handle = cubeDragHandleAxis(point, center, camera, size);
    raycaster.setFromCamera(new Vector2(point.x / size.width * 2 - 1, 1 - point.y / size.height * 2), camera);
    const hit = handle ? null : cubeDragHit(snapshot.state, raycaster.ray);
    if (!handle && (!hit || !snapshot.scopeIds.includes(hit))) return;
    const ids = hit && !snapshot.ids.includes(hit) ? [hit] : snapshot.ids;
    const axis = handle ?? snapshot.axis;
    const projection = cubeDragProjection(center, axis, camera, size);
    stop(event);
    if (!projection) { snapshot.onUnavailable(); return; }
    gesture = { snapshot, pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, projection, ids, axis, hit, dragged: false, distance: 0, cursor: canvas.style.cursor };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
    onGesture?.(true);
    if (handle) snapshot.onAxisChange(axis);
    if (hit && !snapshot.ids.includes(hit)) snapshot.onSelect(hit);
  };
  const update = (event: PointerEvent) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    stop(event);
    if (getInteraction().state !== gesture.snapshot.state) { clear(); return; }
    const delta = { x: event.clientX - gesture.start.x, y: event.clientY - gesture.start.y };
    gesture.dragged ||= Math.hypot(delta.x, delta.y) > 3;
    if (!gesture.dragged) return;
    gesture.distance = Math.max(-48, Math.min(48, cubeDragDistance(delta, gesture.projection)));
    const operation = cubeDragOperation(gesture.snapshot.kind, gesture.ids, gesture.axis, gesture.distance);
    pending = { positions: cubeDragPositions(gesture.snapshot.state, gesture.ids, gesture.axis, gesture.distance), axis: gesture.axis,
      distance: operation?.distance ?? 0, valid: !operation || applyCubeOperation(gesture.snapshot.state, operation) !== gesture.snapshot.state };
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (pending && gesture) onPreview(pending); });
  };
  const up = (event: PointerEvent) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    update(event);
    const finished = clear();
    if (!finished) return;
    if (!finished.dragged) { if (finished.hit) finished.snapshot.onSelect(finished.hit); return; }
    const operation = cubeDragOperation(finished.snapshot.kind, finished.ids, finished.axis, finished.distance);
    if (operation) finished.snapshot.onCommit(operation);
  };
  const cancel = (event: PointerEvent) => { if (gesture?.pointerId === event.pointerId) { stop(event); clear(); } };
  const key = (event: KeyboardEvent) => { if (event.key === "Escape" && gesture) { stop(event); clear(); } };
  const lost = (event: PointerEvent) => { if (gesture?.pointerId === event.pointerId) clear(); };
  const blur = () => { clear(); };
  const wheel = (event: WheelEvent) => { if (gesture) stop(event); };
  const document = canvas.ownerDocument;
  canvas.addEventListener("pointerdown", down, true);
  canvas.addEventListener("lostpointercapture", lost);
  canvas.addEventListener("wheel", wheel, { capture: true, passive: false });
  document.addEventListener("pointermove", update, true);
  document.addEventListener("pointerup", up, true);
  document.addEventListener("pointercancel", cancel, true);
  document.addEventListener("keydown", key, true);
  document.defaultView?.addEventListener("blur", blur);
  return () => {
    clear();
    canvas.removeEventListener("pointerdown", down, true);
    canvas.removeEventListener("lostpointercapture", lost);
    canvas.removeEventListener("wheel", wheel, true);
    document.removeEventListener("pointermove", update, true);
    document.removeEventListener("pointerup", up, true);
    document.removeEventListener("pointercancel", cancel, true);
    document.removeEventListener("keydown", key, true);
    document.defaultView?.removeEventListener("blur", blur);
  };
}

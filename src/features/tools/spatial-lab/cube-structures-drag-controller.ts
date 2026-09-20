import { Raycaster, Vector2, type Camera } from "three";
import type { Axis } from "@/features/spatial-math/domain";
import { applyCubeOperation, cubeDisplayPosition, type CubeStructureState } from "./cube-structures-contract";
import { cubeDragDistance, cubeDragHandleAxis, cubeDragHit, cubeDragOperation, cubeDragPositions, cubeDragProjection, cubeMoveCenter, type CubeMoveOperation, type CubeScreenPoint } from "./cube-structures-drag";
import type { CubeDisplayPositions } from "./cube-structures-motion";
import { isSpatialCameraHandoff, spatialObjectHandleHit, type SpatialObjectInteraction, type SpatialObjectPreview } from "../spatial-interaction/object-gesture-controller";

export interface CubeDragPreview {
  readonly positions: CubeDisplayPositions;
  readonly axis: Axis;
  readonly distance: number;
  readonly valid: boolean;
  readonly ids?: readonly string[];
}
export interface CubeMoveInteraction {
  readonly state: CubeStructureState;
  readonly ids: readonly string[];
  readonly scopeIds: readonly string[];
  readonly axis: Axis;
  readonly kind: CubeMoveOperation["kind"];
  readonly snapToGrid: boolean;
  readonly bodyAxis?: "selected" | "gesture" | "handles";
  readonly enabled?: boolean;
  readonly handleAxes?: readonly Axis[];
  readonly continuousPreview?: boolean;
  readonly bodyGesture?: SpatialObjectInteraction;
  readonly bodyPreview?: SpatialObjectPreview | null;
  readonly showHandles?: boolean;
  readonly idsForHit?: (id: string) => readonly string[];
  readonly hitTest?: (raycaster: Raycaster) => string | null;
  /** 复用到中心位于半格的教学实体时，指定各轴的网格起点。 */
  readonly gridOrigin?: Partial<Record<Axis, number>>;
  readonly isValidOperation?: (operation: CubeMoveOperation) => boolean;
  readonly onAxisChange: (axis: Axis) => void;
  readonly onSelect: (id: string) => void;
  readonly onCommit: (operation: CubeMoveOperation) => void;
  readonly onUnavailable: () => void;
}

/** 一次指针手势只在松手写入终点；捕获、取消和预览均局限在当前画布。 */
export function bindCubeAxisDrag(canvas: HTMLCanvasElement, getInteraction: () => CubeMoveInteraction, getCamera: () => Camera, onPreview: (preview: CubeDragPreview | null) => void, onGesture?: (active: boolean) => void) {
  type Gesture = { snapshot: CubeMoveInteraction; pointerId: number; start: CubeScreenPoint; projection: CubeScreenPoint; projections: Partial<Record<Axis, CubeScreenPoint>>; autoAxis: boolean; ids: readonly string[]; axis: Axis; hit: string | null; gridAnchor: number | undefined; dragged: boolean; operation: CubeMoveOperation | null; cursor: string };
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
    if (isSpatialCameraHandoff(event)) return;
    if (gesture) { stop(event); return; }
    if (event.button !== 0 || event.isPrimary === false) return;
    const snapshot = getInteraction();
    if (snapshot.enabled === false) return;
    if (snapshot.bodyGesture && event.shiftKey) return;
    const camera = getCamera();
    const size = canvas.getBoundingClientRect();
    if (snapshot.bodyGesture && spatialObjectHandleHit(snapshot.bodyGesture, event, camera, size)) return;
    const point = { x: event.clientX - size.left, y: event.clientY - size.top };
    const center = cubeMoveCenter(snapshot.state, snapshot.ids);
    if (!center) return;
    const handle = snapshot.showHandles === false ? null : cubeDragHandleAxis(point, center, camera, size, snapshot.handleAxes, event.pointerType === "touch" ? 22 : 12);
    if (!handle && snapshot.bodyAxis === "handles") return;
    raycaster.setFromCamera(new Vector2(point.x / size.width * 2 - 1, 1 - point.y / size.height * 2), camera);
    const hit = handle ? null : snapshot.hitTest ? snapshot.hitTest(raycaster) : cubeDragHit(snapshot.state, raycaster.ray);
    if (!handle && (!hit || !snapshot.scopeIds.includes(hit))) return;
    const ids = hit ? snapshot.idsForHit?.(hit) ?? (snapshot.ids.includes(hit) ? snapshot.ids : [hit]) : snapshot.ids;
    const anchor = cubeMoveCenter(snapshot.state, ids) ?? center;
    const projections = Object.fromEntries((["x", "y", "z"] as const).flatMap((axis) => {
      const projected = cubeDragProjection(anchor, axis, camera, size); return projected ? [[axis, projected]] : [];
    })) as Partial<Record<Axis, CubeScreenPoint>>;
    const autoAxis = !handle && snapshot.bodyAxis === "gesture";
    const axis = handle ?? (projections[snapshot.axis] ? snapshot.axis : autoAxis ? (["x", "y", "z"] as const).find((axis) => projections[axis]) ?? snapshot.axis : snapshot.axis);
    const projection = projections[axis];
    stop(event);
    if (!projection) { snapshot.onUnavailable(); return; }
    const anchorCube = snapshot.state.cubes.find((cube) => hit ? cube.id === hit : ids.includes(cube.id) && !snapshot.state.hiddenCubeIds.includes(cube.id));
    const gridAnchor = snapshot.snapToGrid ? anchorCube && snapshot.gridOrigin ? cubeDisplayPosition(anchorCube)[axis] - (snapshot.gridOrigin[axis] ?? 0)
      : snapshot.kind === "display-move" && anchorCube ? cubeDisplayPosition(anchorCube)[axis] : 0 : undefined;
    gesture = { snapshot, pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, projection, projections, autoAxis, ids, axis, hit, gridAnchor, dragged: false, operation: null, cursor: canvas.style.cursor };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
    onGesture?.(true);
    if (handle) snapshot.onAxisChange(axis);
    // 选择在轻点松手时提交；拖动另一物体直接提交它的终点，不先发一条选择快照。
  };
  const update = (event: PointerEvent) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    stop(event);
    const current = getInteraction();
    if (current.enabled === false || current.state !== gesture.snapshot.state) { clear(); return; }
    const delta = { x: event.clientX - gesture.start.x, y: event.clientY - gesture.start.y };
    if (!gesture.dragged && Math.hypot(delta.x, delta.y) > 3) {
      gesture.dragged = true;
      if (gesture.autoAxis) {
        let score = -1;
        for (const axis of [gesture.axis, ...(["x", "y", "z"] as const).filter((axis) => axis !== gesture!.axis)]) {
          const projection = gesture.projections[axis]; if (!projection) continue;
          const aligned = Math.abs(delta.x * projection.x + delta.y * projection.y) / Math.hypot(projection.x, projection.y);
          if (aligned > score + 1e-6) { score = aligned; gesture.axis = axis; gesture.projection = projection; }
        }
        const cube = gesture.snapshot.state.cubes.find((cube) => gesture!.hit ? cube.id === gesture!.hit : gesture!.ids.includes(cube.id));
        gesture.gridAnchor = gesture.snapshot.snapToGrid ? cube && gesture.snapshot.gridOrigin ? cubeDisplayPosition(cube)[gesture.axis] - (gesture.snapshot.gridOrigin[gesture.axis] ?? 0)
          : gesture.snapshot.kind === "display-move" && cube ? cubeDisplayPosition(cube)[gesture.axis] : 0 : undefined;
        gesture.snapshot.onAxisChange(gesture.axis);
      }
    }
    if (!gesture.dragged) return;
    const distance = Math.max(-48, Math.min(48, cubeDragDistance(delta, gesture.projection)));
    const operation = cubeDragOperation(gesture.snapshot.kind, gesture.ids, gesture.axis, distance, gesture.gridAnchor);
    gesture.operation = operation;
    pending = { positions: cubeDragPositions(gesture.snapshot.state, gesture.ids, gesture.axis, gesture.snapshot.snapToGrid && !gesture.snapshot.continuousPreview ? operation?.distance ?? 0 : distance), axis: gesture.axis, ids: gesture.ids,
      distance: operation?.distance ?? 0, valid: !operation || (gesture.snapshot.isValidOperation?.(operation) ?? (applyCubeOperation(gesture.snapshot.state, operation) !== gesture.snapshot.state)) };
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (pending && gesture) onPreview(pending); });
  };
  const up = (event: PointerEvent) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    update(event);
    const finished = clear();
    if (!finished) return;
    if (!finished.dragged) { if (finished.hit) finished.snapshot.onSelect(finished.hit); return; }
    if (finished.operation) finished.snapshot.onCommit(finished.operation);
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

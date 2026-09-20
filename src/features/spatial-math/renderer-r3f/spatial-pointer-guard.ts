import { SPATIAL_OBJECT_GESTURE_START } from "./spatial-object-gesture";

export const SPATIAL_TAP_SLOP_PX = 5;

/** 记录完整手势，而非只比较首尾；拖回起点、双指及取消均不产生涂色/删除等点击。 */
export function bindSpatialPointerGuard(canvas: HTMLCanvasElement): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let blocked = false;
  const down = (event: PointerEvent) => {
    if (!canvas.contains(event.target as Node)) return;
    if (!pointers.size) blocked = event.button !== 0;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size > 1) blocked = true;
  };
  const move = (event: PointerEvent) => {
    const start = pointers.get(event.pointerId);
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > SPATIAL_TAP_SLOP_PX) blocked = true;
  };
  const up = (event: PointerEvent) => { move(event); pointers.delete(event.pointerId); };
  const cancel = () => { blocked = true; pointers.clear(); };
  const claim = () => { blocked = true; };
  const click = (event: MouseEvent) => {
    if (blocked || event.button !== 0) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  const view = canvas.ownerDocument.defaultView;
  // Window capture 先于对象控制器；对象可以接管后续事件，记录仍完整。
  view?.addEventListener("pointerdown", down, true);
  view?.addEventListener("pointermove", move, true);
  view?.addEventListener("pointerup", up, true);
  view?.addEventListener("pointercancel", cancel, true);
  view?.addEventListener("blur", cancel);
  canvas.addEventListener(SPATIAL_OBJECT_GESTURE_START, claim);
  canvas.addEventListener("click", click, true);
  return () => {
    view?.removeEventListener("pointerdown", down, true);
    view?.removeEventListener("pointermove", move, true);
    view?.removeEventListener("pointerup", up, true);
    view?.removeEventListener("pointercancel", cancel, true);
    view?.removeEventListener("blur", cancel);
    canvas.removeEventListener(SPATIAL_OBJECT_GESTURE_START, claim);
    canvas.removeEventListener("click", click, true);
  };
}

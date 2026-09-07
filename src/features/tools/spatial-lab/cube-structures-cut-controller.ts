import type { Camera } from "three";
import type { CubeStructureState } from "./cube-structures-contract";
import type { CubeCutHit } from "./cube-structures-cut-interaction";
import { buildCubeCutGeometry, cubeCutHitKey, pickCubeCut } from "./cube-structures-cut-picking";

export interface CubeCutInteraction {
  readonly state: CubeStructureState;
  readonly hovered?: CubeCutHit | null;
  readonly onHover: (hit: CubeCutHit | null) => void;
  readonly onPick: (hit: CubeCutHit | null) => void;
}

/** 切割有独立的几何命中入口，实体的 R3F 实例事件不再抢先截断候选。 */
export function bindCubeCutPicking(canvas: HTMLCanvasElement, getInteraction: () => CubeCutInteraction, getCamera: () => Camera) {
  let snapshot = getInteraction();
  let geometry = buildCubeCutGeometry(snapshot.state);
  let hovered: CubeCutHit | null = null;
  let down: { pointerId: number; x: number; y: number; moved: boolean; state: CubeStructureState } | null = null;
  const pointers = new Set<number>();
  const activeHover = () => getInteraction().hovered === undefined ? hovered : getInteraction().hovered!;
  const hover = (hit: CubeCutHit | null) => {
    if (cubeCutHitKey(hit) !== cubeCutHitKey(activeHover())) { hovered = hit; getInteraction().onHover(hit); }
  };
  const pick = (event: PointerEvent) => {
    const current = getInteraction();
    if (snapshot.state !== current.state) geometry = buildCubeCutGeometry(current.state);
    snapshot = current;
    const size = canvas.getBoundingClientRect();
    return pickCubeCut(geometry, "auto", { x: event.clientX - size.left, y: event.clientY - size.top }, getCamera(), size, activeHover(), event.pointerType === "touch" ? 12 : 8);
  };
  const start = (event: PointerEvent) => {
    pointers.add(event.pointerId);
    if (event.button !== 0 || event.isPrimary === false || pointers.size > 1) { down = null; hover(null); return; }
    const current = getInteraction();
    down = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, state: current.state };
  };
  const move = (event: PointerEvent) => {
    if (down?.pointerId === event.pointerId && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) down.moved = true;
    if (event.target === canvas && pointers.size <= 1 && (event.buttons === 0 || event.buttons === 1)) hover(pick(event));
  };
  const end = (event: PointerEvent) => {
    const gesture = down;
    pointers.delete(event.pointerId); down = null;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.moved || Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) return;
    const current = getInteraction();
    if (current.state !== gesture.state) return;
    const size = canvas.getBoundingClientRect();
    if (event.clientX < size.left || event.clientX > size.right || event.clientY < size.top || event.clientY > size.bottom) return;
    const hit = pick(event); hover(hit); current.onPick(hit);
  };
  const leave = () => hover(null);
  const cancel = () => { down = null; pointers.clear(); hover(null); };
  const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
  const document = canvas.ownerDocument;
  canvas.addEventListener("pointerdown", start, true);
  canvas.addEventListener("pointerleave", leave);
  canvas.addEventListener("lostpointercapture", cancel);
  canvas.addEventListener("wheel", cancel, { passive: true });
  document.addEventListener("pointermove", move, true);
  document.addEventListener("pointerup", end, true);
  document.addEventListener("pointercancel", cancel, true);
  document.addEventListener("keydown", keydown, true);
  document.defaultView?.addEventListener("blur", cancel);
  return () => {
    down = null; pointers.clear();
    canvas.removeEventListener("pointerdown", start, { capture: true });
    canvas.removeEventListener("pointerleave", leave);
    canvas.removeEventListener("lostpointercapture", cancel);
    canvas.removeEventListener("wheel", cancel);
    document.removeEventListener("pointermove", move, { capture: true });
    document.removeEventListener("pointerup", end, { capture: true });
    document.removeEventListener("pointercancel", cancel, { capture: true });
    document.removeEventListener("keydown", keydown, { capture: true });
    document.defaultView?.removeEventListener("blur", cancel);
  };
}

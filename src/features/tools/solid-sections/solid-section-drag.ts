import { Plane, Raycaster, Vector2, Vector3, type Camera } from "three";
import type { SolidEntity } from "../solid-geometry/solid-geometry-contract";
import { cubeDragDistance, cubeScreenPoint, type CubeScreenPoint } from "../spatial-lab/cube-structures-drag";
import type { SolidSectionSettings } from "./solid-sections-contract";
import { sectionAdd, sectionDot, sectionPlaneBasis, sectionScale, sectionSubtract, solidSectionGuideRadius, solidSectionNormal, solidSectionPlane } from "./solid-sections";

export type SectionDragPart = "offset" | "tiltA" | "tiltB";
type Size = { width: number; height: number };
export interface SectionDragInteraction {
  entity: SolidEntity;
  settings: SolidSectionSettings;
  onCommit: (settings: SolidSectionSettings) => void;
}
export function sectionDragHandles(entity: SolidEntity, settings: SolidSectionSettings) {
  const plane = solidSectionPlane(entity, solidSectionNormal(settings), settings.offset);
  const { u, v } = sectionPlaneBasis(plane.normal), radius = solidSectionGuideRadius(entity);
  const anchor = (a: number, b: number) => sectionAdd(plane.origin, sectionAdd(sectionScale(u, a * radius), sectionScale(v, b * radius)));
  return { offset: anchor(-1, 0), tiltA: anchor(1, 1), tiltB: anchor(1, -1) };
}
export function sectionDragHit(point: CubeScreenPoint, interaction: SectionDragInteraction, camera: Camera, size: Size): SectionDragPart | null {
  const { entity, settings } = interaction;
  if (!settings.enabled || !settings.showPlane || !size.width || !size.height) return null;
  const handles = sectionDragHandles(entity, settings);
  // 圆柄按屏幕像素命中；缩放后仍保留触摸热区。
  for (const part of ["tiltA", "tiltB", "offset"] as const) {
    const projected = cubeScreenPoint(handles[part], camera, size);
    if (Math.hypot(point.x - projected.x, point.y - projected.y) <= 22) return part;
  }
  const plane = solidSectionPlane(entity, solidSectionNormal(settings), settings.offset);
  const ray = new Raycaster(); ray.setFromCamera(new Vector2(point.x / size.width * 2 - 1, 1 - point.y / size.height * 2), camera);
  const hit = ray.ray.intersectPlane(new Plane().setFromNormalAndCoplanarPoint(new Vector3(plane.normal.x, plane.normal.y, plane.normal.z), new Vector3(plane.origin.x, plane.origin.y, plane.origin.z)), new Vector3());
  if (!hit) return null;
  const { u, v } = sectionPlaneBasis(plane.normal), relative = sectionSubtract(hit, plane.origin), radius = solidSectionGuideRadius(entity);
  return Math.abs(sectionDot(relative, u)) <= radius && Math.abs(sectionDot(relative, v)) <= radius ? "offset" : null;
}
export function sectionDragProjection(interaction: SectionDragInteraction, part: SectionDragPart, camera: Camera, size: Size): CubeScreenPoint {
  const { entity, settings } = interaction;
  const from = cubeScreenPoint(sectionDragHandles(entity, settings)[part], camera, size);
  const step = part === "offset" ? 1 : 10;
  const next = { ...settings, [part]: settings[part] + step };
  const to = cubeScreenPoint(sectionDragHandles(entity, next)[part], camera, size);
  const projection = { x: (to.x - from.x) / step, y: (to.y - from.y) / step };
  if (part === "offset") {
    // 正对切平面时法线缩为一点，向上拖仍可推进切面，不制造巨大跳动。
    return Math.hypot(projection.x, projection.y) >= 16 ? projection : { x: 0, y: -Math.max(80, size.height * 0.22) };
  }
  const length = Math.hypot(projection.x, projection.y);
  return length >= 0.5 ? { x: projection.x / length * 2, y: projection.y / length * 2 } : part === "tiltA" ? { x: 0, y: -2 } : { x: 2, y: 0 };
}
export function sectionDragSettings(settings: SolidSectionSettings, part: SectionDragPart, delta: CubeScreenPoint, projection: CubeScreenPoint): SolidSectionSettings {
  // 复用轴拖动投影；倾斜按十度为投影单位，保持其数值稳定门。
  const amount = cubeDragDistance(delta, part === "offset" ? projection : { x: projection.x * 10, y: projection.y * 10 }) * (part === "offset" ? 1 : 10);
  const limit = part === "offset" ? 1.2 : 90;
  return { ...settings, [part]: Math.round(Math.max(-limit, Math.min(limit, settings[part] + amount)) * 10000) / 10000 };
}
const interactionKey = (interaction: SectionDragInteraction) => JSON.stringify([interaction.entity, interaction.settings]);

/** 与轴拖动相同的画布捕获边界：仅手势终点写入课堂，空白位置留给相机。 */
export function bindSolidSectionDrag(canvas: HTMLCanvasElement, getInteraction: () => SectionDragInteraction | null, getCamera: () => Camera,
  onPreview: (settings: SolidSectionSettings | null) => void, onGesture: (active: boolean) => void) {
  type Gesture = { interaction: SectionDragInteraction; key: string; part: SectionDragPart; pointerId: number; start: CubeScreenPoint; projection: CubeScreenPoint; next: SolidSectionSettings | null; cursor: string };
  let gesture: Gesture | null = null;
  const stop = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const clear = () => {
    const previous = gesture; gesture = null;
    if (previous) {
      canvas.style.cursor = previous.cursor;
      if (canvas.hasPointerCapture(previous.pointerId)) canvas.releasePointerCapture(previous.pointerId);
      onPreview(null); onGesture(false);
    }
    return previous;
  };
  const down = (event: PointerEvent) => {
    if (gesture) { stop(event); clear(); return; }
    if (event.button !== 0 || event.isPrimary === false) return;
    const interaction = getInteraction(); if (!interaction) return;
    const camera = getCamera(), size = canvas.getBoundingClientRect();
    const part = sectionDragHit({ x: event.clientX - size.left, y: event.clientY - size.top }, interaction, camera, size);
    if (!part) return;
    stop(event);
    gesture = { interaction, key: interactionKey(interaction), part, pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, projection: sectionDragProjection(interaction, part, camera, size), next: null, cursor: canvas.style.cursor };
    canvas.setPointerCapture(event.pointerId); canvas.style.cursor = "grabbing"; onGesture(true);
  };
  const move = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    stop(event);
    const current = getInteraction();
    if (!current || interactionKey(current) !== gesture.key) { clear(); return; }
    const delta = { x: event.clientX - gesture.start.x, y: event.clientY - gesture.start.y };
    if (!gesture.next && Math.hypot(delta.x, delta.y) < 3) return;
    gesture.next = sectionDragSettings(gesture.interaction.settings, gesture.part, delta, gesture.projection);
    onPreview(gesture.next);
  };
  const up = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    move(event); const finished = clear();
    if (finished?.next && JSON.stringify(finished.next) !== JSON.stringify(finished.interaction.settings)) finished.interaction.onCommit(finished.next);
  };
  const cancel = (event: PointerEvent) => { if (gesture?.pointerId === event.pointerId) { stop(event); clear(); } };
  const key = (event: KeyboardEvent) => { if (gesture && event.key === "Escape") { stop(event); clear(); } };
  const blur = () => { clear(); };
  const wheel = (event: WheelEvent) => { if (gesture) stop(event); };
  const document = canvas.ownerDocument;
  canvas.addEventListener("pointerdown", down, true);
  canvas.addEventListener("lostpointercapture", cancel);
  canvas.addEventListener("wheel", wheel, { capture: true, passive: false });
  document.addEventListener("pointermove", move, true);
  document.addEventListener("pointerup", up, true);
  document.addEventListener("pointercancel", cancel, true);
  document.addEventListener("keydown", key, true);
  document.defaultView?.addEventListener("blur", blur);
  return () => {
    clear(); canvas.removeEventListener("pointerdown", down, true); canvas.removeEventListener("lostpointercapture", cancel); canvas.removeEventListener("wheel", wheel, true);
    document.removeEventListener("pointermove", move, true); document.removeEventListener("pointerup", up, true); document.removeEventListener("pointercancel", cancel, true); document.removeEventListener("keydown", key, true);
    document.defaultView?.removeEventListener("blur", blur);
  };
}

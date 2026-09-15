import { Vector3, type Camera } from "three";
import { diceFaceArrow } from "./dice-teaching-display";
import { DICE_FACES, FACE_NORMALS, diceFaceTranslation, isDiceFaceMoved, positionData, quaternion, vector, worldNormal, type DiceFace, type TeachingDie } from "./dice-teaching-model";

export interface DiceScreenRect { left: number; top: number; right: number; bottom: number }
export interface DiceObservationView {
  camera: Camera; width: number; height: number; obstacles: readonly DiceScreenRect[]; floor: boolean;
}
export type DiceObservationFailure = { id: string; face: DiceFace; reason: "side-on" | "no-space" };
export interface DiceObservationResult { dice: TeachingDie[]; failures: DiceObservationFailure[] }
export interface DiceObservationApi {
  plan: (dice: readonly TeachingDie[], id: string, faces: readonly DiceFace[]) => DiceObservationResult;
}
export const DICE_FACE_EXTRACTION = 0.18;
const SCREEN_GAP = 10;

/** 使用整张单位面包围圆角纸片；引线和轮廓与真实面共用同一坐标变换。 */
export function diceFaceCorners(die: TeachingDie, face: DiceFace, moved = true): Vector3[] {
  const n = vector(FACE_NORMALS[face]);
  const u = new Vector3(...(face[0] === "x" ? [0, 0, 1] as const : [1, 0, 0] as const));
  const v = n.clone().cross(u);
  const translation = moved ? diceFaceTranslation(die, face) : new Vector3();
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => n.clone().multiplyScalar(0.5)
    .addScaledVector(u, x * 0.5).addScaledVector(v, y * 0.5).add(translation).applyQuaternion(quaternion(die.rotation)).add(vector(die.position)));
}
function project(point: Vector3, view: DiceObservationView) {
  const p = point.clone().project(view.camera);
  return { x: (p.x + 1) * view.width / 2, y: (1 - p.y) * view.height / 2 };
}
function bounds(points: readonly Vector3[], view: DiceObservationView): DiceScreenRect {
  const p = points.map((point) => project(point, view));
  return { left: Math.min(...p.map((point) => point.x)), right: Math.max(...p.map((point) => point.x)), top: Math.min(...p.map((point) => point.y)), bottom: Math.max(...p.map((point) => point.y)) };
}
function expand(rect: DiceScreenRect, padding: number): DiceScreenRect {
  return { left: rect.left - padding, right: rect.right + padding, top: rect.top - padding, bottom: rect.bottom + padding };
}
export function diceScreenRectsOverlap(a: DiceScreenRect, b: DiceScreenRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
export function diceBodyScreenBounds(die: TeachingDie, view: DiceObservationView): DiceScreenRect {
  return bounds(DICE_FACES.flatMap((face) => diceFaceCorners(die, face, false)), view);
}
export function diceFaceScreenBounds(die: TeachingDie, face: DiceFace, view: DiceObservationView, includeArrow = false): DiceScreenRect {
  // 圆角面组向骰子内部延伸，连同背缘一起预留投影空间。
  const corners = diceFaceCorners(die, face), normal = worldNormal(die, face);
  const rect = bounds([...corners, ...corners.map((p) => p.clone().addScaledVector(normal, -0.085))], view);
  if (!includeArrow) return rect;
  const arrow = project(diceFaceArrow(die, face, "").position, view);
  return { left: Math.min(rect.left, arrow.x - 24), right: Math.max(rect.right, arrow.x + 24), top: Math.min(rect.top, arrow.y - 24), bottom: Math.max(rect.bottom, arrow.y + 24) };
}
function setLanding(die: TeachingDie, face: DiceFace, shift: Vector3): TeachingDie {
  return { ...die, offsets: { ...die.offsets, [face]: DICE_FACE_EXTRACTION }, faceShifts: { ...die.faceShifts, [face]: positionData(shift) } };
}

/** 只在老师点击时寻找落点。计算不修改相机、其他骰子、显隐或教学样式。 */
function planOne(dice: readonly TeachingDie[], id: string, face: DiceFace, view: DiceObservationView): TeachingDie | DiceObservationFailure {
  const die = dice.find((item) => item.id === id)!;
  if (isDiceFaceMoved(die, face)) return die;
  const normal = worldNormal(die, face), towardCamera = view.camera.getWorldDirection(new Vector3()).negate();
  if (Math.abs(normal.dot(towardCamera)) < 0.18) return { id, face, reason: "side-on" };
  const source = vector(die.position).addScaledVector(normal, 0.5), extracted = source.clone().addScaledVector(normal, DICE_FACE_EXTRACTION);
  const projected = project(extracted, view), sourceScreen = project(source, view), depth = extracted.clone().project(view.camera).z;
  const preferred = Math.hypot(projected.x - sourceScreen.x, projected.y - sourceScreen.y) > 1
    ? Math.atan2(projected.y - sourceScreen.y, projected.x - sourceScreen.x) : -Math.PI / 4;
  const occupied = [
    ...view.obstacles,
    ...dice.map((item) => diceBodyScreenBounds(item, view)),
    ...dice.flatMap((item) => DICE_FACES.filter((side) => isDiceFaceMoved(item, side)).map((side) => diceFaceScreenBounds(item, side, view, true))),
  ].map((rect) => expand(rect, SCREEN_GAP));
  const visible = { left: 12, top: 12, right: view.width - 12, bottom: view.height - 12 };
  const faceBounds = diceFaceScreenBounds(die, face, view);
  const step = Math.max(8, Math.min(faceBounds.right - faceBounds.left, faceBounds.bottom - faceBounds.top) / 5);
  let best: { die: TeachingDie; score: number } | null = null;
  const inverse = quaternion(die.rotation).invert();
  for (let radius = 0; radius <= Math.hypot(view.width, view.height); radius += step) {
    if (best && radius > best.score) break;
    for (let direction = 0; direction < 32; direction++) {
      const angle = preferred + direction * Math.PI / 16;
      const x = projected.x + Math.cos(angle) * radius, y = projected.y + Math.sin(angle) * radius;
      if (x < visible.left || x > visible.right || y < visible.top || y > visible.bottom) continue;
      const target = new Vector3(x / view.width * 2 - 1, 1 - y / view.height * 2, depth).unproject(view.camera);
      const worldShift = target.clone().sub(extracted);
      // 底面可以先抽下、再移到桌面上方的观察空位；保持面的真实朝向。
      const lowest = Math.min(...diceFaceCorners(die, face, false).map((p) => p.y)) + normal.y * DICE_FACE_EXTRACTION + worldShift.y;
      if (view.floor && view.camera.position.y > 0 && lowest < 0.12) {
        if (towardCamera.y < 0.08) continue;
        worldShift.addScaledVector(towardCamera, (0.12 - lowest) / towardCamera.y);
      }
      if (worldShift.length() > 10) continue;
      const candidate = setLanding(die, face, worldShift.clone().applyQuaternion(inverse));
      const rect = diceFaceScreenBounds(candidate, face, view, true);
      if (rect.left < visible.left || rect.right > visible.right || rect.top < visible.top || rect.bottom > visible.bottom) continue;
      if (occupied.some((other) => diceScreenRectsOverlap(rect, other))) continue;
      // 优先就近，次选沿面朝向；深度绕行只在保留同一投影时使用。
      const score = radius * (1 + 0.12 * (1 - Math.cos(angle - preferred))) + worldShift.length() * 2;
      if (!best || score < best.score) best = { die: candidate, score };
    }
  }
  return best?.die ?? { id, face, reason: "no-space" };
}

export function planDiceFaceObservations(dice: readonly TeachingDie[], id: string, faces: readonly DiceFace[], view: DiceObservationView): DiceObservationResult {
  let next = [...dice];
  const failures: DiceObservationFailure[] = [];
  if (!dice.some((die) => die.id === id)) return { dice: next, failures };
  // 同一次打开相对面也逐个预留位置，第二面看得见第一面的终点。
  for (const face of faces) {
    const result = planOne(next, id, face, view);
    if ("reason" in result) failures.push(result);
    else next = next.map((die) => die.id === id ? result : die);
  }
  return { dice: next, failures };
}

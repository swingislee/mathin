import { Quaternion, Vector3 } from "three";
import type { DiceSurfaceStyle } from "./dice-teaching-display";

export const DICE_TEACHING_VERSION = "dice-teaching-v1" as const;
export const MAX_DICE = 8;
export const DICE_BOARD_LIMIT = 6;
export const DICE_FACE_MOVE_DISTANCE = 1.1;
export const DICE_FACES = ["x+", "x-", "y+", "y-", "z+", "z-"] as const;
export type DiceFace = (typeof DICE_FACES)[number];
export type DiceHand = "right" | "left";
export type RollDirection = "x+" | "x-" | "z+" | "z-";
export interface DiceVector { x: number; y: number; z: number }
export interface DiceRotation extends DiceVector { w: number }
export interface TeachingDie {
  id: string;
  hand: DiceHand;
  position: DiceVector;
  rotation: DiceRotation;
  hidden: DiceFace[];
  offsets: Partial<Record<DiceFace, number>>;
  surfaces?: Partial<Record<DiceFace, DiceSurfaceStyle>>;
}
export interface DiceFootprint { x: number; z: number; value: number; points: DiceVector[] }
export interface DicePuzzle { scope: "each" | "total"; target: number; revealed: boolean }
export interface DiceScene { version: typeof DICE_TEACHING_VERSION; dice: TeachingDie[]; trail: DiceFootprint[]; nextId: number; puzzle: DicePuzzle | null }
export const FACE_NORMALS: Record<DiceFace, DiceVector> = {
  "x+": { x: 1, y: 0, z: 0 }, "x-": { x: -1, y: 0, z: 0 },
  "y+": { x: 0, y: 1, z: 0 }, "y-": { x: 0, y: -1, z: 0 },
  "z+": { x: 0, y: 0, z: 1 }, "z-": { x: 0, y: 0, z: -1 },
};
export const IDENTITY_ROTATION: DiceRotation = { x: 0, y: 0, z: 0, w: 1 };
export const vector = (v: DiceVector) => new Vector3(v.x, v.y, v.z);
export const quaternion = (q: DiceRotation) => new Quaternion(q.x, q.y, q.z, q.w);
export const rotationData = (q: Quaternion): DiceRotation => ({ x: q.x, y: q.y, z: q.z, w: q.w });
export const positionData = (p: Vector3): DiceVector => ({ x: p.x, y: p.y, z: p.z });
export const oppositeFace = (face: DiceFace): DiceFace => `${face[0]}${face[1] === "+" ? "-" : "+"}` as DiceFace;

/** 1、2、3 外法向为正定向时记为右手系；左手系只镜像 X，任意转动保持手性。 */
export function faceValue(hand: DiceHand, face: DiceFace): number {
  const values: Record<DiceFace, number> = { "y+": 1, "y-": 6, "z+": 2, "z-": 5, "x+": hand === "right" ? 3 : 4, "x-": hand === "right" ? 4 : 3 };
  return values[face];
}
export function createDie(id: string, hand: DiceHand, position: DiceVector): TeachingDie {
  return { id, hand, position, rotation: { ...IDENTITY_ROTATION }, hidden: [], offsets: {} };
}
export function createDiceScene(): DiceScene {
  return { version: DICE_TEACHING_VERSION, dice: [createDie("dice-1", "right", { x: -1, y: 0.5, z: 0 }), createDie("dice-2", "left", { x: 1, y: 0.5, z: 0 })], trail: [], nextId: 3, puzzle: null };
}
export function worldNormal(die: TeachingDie, face: DiceFace): Vector3 {
  return vector(FACE_NORMALS[face]).applyQuaternion(quaternion(die.rotation));
}
export function diceFaceTranslation(die: TeachingDie, face: DiceFace): Vector3 {
  return vector(FACE_NORMALS[face]).multiplyScalar(die.offsets[face] ?? 0);
}
export function isDiceFaceMoved(die: TeachingDie, face: DiceFace): boolean { return diceFaceTranslation(die, face).lengthSq() > 0.000001; }
/** 沿各面的法向直线移出；距离以骰子边长为单位，与视角和浮窗位置无关。 */
export function openDieFaces(die: TeachingDie, faces: readonly DiceFace[]): TeachingDie {
  if (faces.every((face) => die.offsets[face] === DICE_FACE_MOVE_DISTANCE)) return die;
  const offsets = { ...die.offsets };
  for (const face of faces) offsets[face] = DICE_FACE_MOVE_DISTANCE;
  return { ...die, offsets };
}
export function closeDieFaces(die: TeachingDie, faces: readonly DiceFace[] = DICE_FACES): TeachingDie {
  const offsets = { ...die.offsets };
  for (const face of faces) delete offsets[face];
  return { ...die, offsets };
}
export function worldFace(die: TeachingDie, direction: DiceFace, tolerance = 0.98): DiceFace | null {
  return DICE_FACES.find((face) => worldNormal(die, face).dot(vector(FACE_NORMALS[direction])) >= tolerance) ?? null;
}
export function turnDie(die: TeachingDie, axis: "x" | "y" | "z", quarters = 1): TeachingDie {
  const turn = new Quaternion().setFromAxisAngle(vector(FACE_NORMALS[`${axis}+`]), quarters * Math.PI / 2);
  return { ...die, rotation: rotationData(turn.multiply(quaternion(die.rotation)).normalize()) };
}
function orientationKey(q: DiceRotation): string {
  return ["x+", "y+", "z+"].map((face) => vector(FACE_NORMALS[face as DiceFace]).applyQuaternion(quaternion(q)).toArray().map(Math.round).join(",")).join(";");
}
export const DICE_ORIENTATIONS: readonly DiceRotation[] = (() => {
  const result: DiceRotation[] = [{ ...IDENTITY_ROTATION }];
  const seen = new Set([orientationKey(IDENTITY_ROTATION)]);
  for (let i = 0; i < result.length; i++) for (const axis of ["x", "y", "z"] as const) {
    const rotated = turnDie({ ...createDie("orientation", "right", { x: 0, y: 0, z: 0 }), rotation: result[i] }, axis).rotation;
    const key = orientationKey(rotated);
    if (!seen.has(key)) { seen.add(key); result.push(rotated); }
  }
  return result;
})();
export function nearestDiceRotation(rotation: DiceRotation): DiceRotation {
  const q = quaternion(rotation);
  return DICE_ORIENTATIONS.reduce((best, item) => Math.abs(q.dot(quaternion(item))) > Math.abs(q.dot(quaternion(best))) ? item : best);
}
export function canPlaceDie(dice: readonly TeachingDie[], id: string, position: DiceVector): boolean {
  return Math.abs(position.x) <= DICE_BOARD_LIMIT - 1 && Math.abs(position.z) <= DICE_BOARD_LIMIT - 1 && position.y >= 0.5 && position.y <= 7.5
    && dice.every((die) => die.id === id || Math.abs(die.position.x - position.x) >= 0.999 || Math.abs(die.position.y - position.y) >= 0.999 || Math.abs(die.position.z - position.z) >= 0.999);
}
export function isGridDie(die: TeachingDie): boolean {
  return [die.position.x, die.position.y - 0.5, die.position.z].every((n) => Math.abs(n - Math.round(n)) < 0.001)
    && Math.abs(quaternion(die.rotation).dot(quaternion(nearestDiceRotation(die.rotation)))) > 0.99999;
}
export function arrangeDice(dice: readonly TeachingDie[], layout: "row" | "stack" | "corner" | "apart"): TeachingDie[] {
  return dice.map((die, index) => ({ ...closeDieFaces(die), rotation: nearestDiceRotation(die.rotation), position: layout === "stack"
    ? { x: 0, y: index + 0.5, z: 0 }
    : layout === "corner" ? { x: index < 3 ? index - 1 : 1, y: 0.5, z: index < 3 ? 0 : index - 2 }
      : layout === "apart" ? { x: (index % 4 - (Math.min(dice.length, 4) - 1) / 2) * 2, y: 0.5, z: (Math.floor(index / 4) - (Math.ceil(dice.length / 4) - 1) / 2) * 2 }
        : { x: index - Math.floor(dice.length / 2), y: 0.5, z: 0 } }));
}

export const PIP_POINTS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  0: [], 1: [[0, 0]], 2: [[-0.24, 0.24], [0.24, -0.24]],
  3: [[-0.24, 0.24], [0, 0], [0.24, -0.24]],
  4: [[-0.24, 0.24], [0.24, 0.24], [-0.24, -0.24], [0.24, -0.24]],
  5: [[-0.24, 0.24], [0.24, 0.24], [0, 0], [-0.24, -0.24], [0.24, -0.24]],
  6: [[-0.24, 0.24], [0.24, 0.24], [-0.24, 0], [0.24, 0], [-0.24, -0.24], [0.24, -0.24]],
};
/** 与 Three Box / RoundedBox 的 UV 方向一致。 */
const FACE_UV: Record<DiceFace, readonly [DiceFace, DiceFace]> = {
  "x+": ["z-", "y+"], "x-": ["z+", "y+"], "y+": ["x+", "z-"], "y-": ["x+", "z+"], "z+": ["x+", "y+"], "z-": ["x-", "y+"],
};
export function footprint(die: TeachingDie): DiceFootprint | null {
  const face = worldFace(die, "y-");
  if (!face) return null;
  const [u, v] = FACE_UV[face];
  const value = faceValue(die.hand, face);
  const points = PIP_POINTS[value].map(([x, y]) => {
    const p = vector(FACE_NORMALS[face]).multiplyScalar(0.5).addScaledVector(vector(FACE_NORMALS[u]), x).addScaledVector(vector(FACE_NORMALS[v]), y)
      .applyQuaternion(quaternion(die.rotation)).add(vector(die.position));
    return { x: p.x, y: 0.008, z: p.z };
  });
  return { x: die.position.x, z: die.position.z, value, points };
}
export function addFootprints(trail: readonly DiceFootprint[], dice: readonly TeachingDie[]): DiceFootprint[] {
  let next = [...trail];
  for (const die of dice) {
    const stamp = footprint(die);
    if (stamp) next = [...next.filter((item) => Math.hypot(item.x - stamp.x, item.z - stamp.z) > 0.01), stamp];
  }
  return next.slice(-128);
}
/** 沿底边转动而非中心自转，任意中间帧均保持与 X–Z 平面相切。 */
export function sampleControlledRoll(die: TeachingDie, direction: RollDirection, progress: number): TeachingDie {
  const d = vector(FACE_NORMALS[direction]);
  const pivot = vector(die.position).addScaledVector(d, 0.5).add(new Vector3(0, -0.5, 0));
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0).cross(d), Math.max(0, Math.min(1, progress)) * Math.PI / 2);
  return { ...closeDieFaces(die), position: positionData(vector(die.position).sub(pivot).applyQuaternion(q).add(pivot)), rotation: rotationData(q.multiply(quaternion(die.rotation)).normalize()) };
}
export function controlledRoll(scene: DiceScene, id: string, direction: RollDirection, leaveTrail: boolean): DiceScene | null {
  const die = scene.dice.find((item) => item.id === id);
  if (!die || !isGridDie(die) || Math.abs(die.position.y - 0.5) > 0.001 || DICE_FACES.some((face) => isDiceFaceMoved(die, face))) return null;
  const next = sampleControlledRoll(die, direction, 1);
  next.position = { x: Math.round(next.position.x), y: 0.5, z: Math.round(next.position.z) };
  next.rotation = nearestDiceRotation(next.rotation);
  if (!canPlaceDie(scene.dice, id, next.position)) return null;
  // 翻起阶段会超过一格高；禁止从别的骰子底下穿过或穿过邻接骰子。
  for (let step = 1; step < 12; step++) {
    const p = sampleControlledRoll(die, direction, step / 12).position;
    const extent = (Math.cos(step / 12 * Math.PI / 2) + Math.sin(step / 12 * Math.PI / 2)) / 2;
    if (scene.dice.some((other) => other.id !== id && Math.abs(other.position.y - p.y) < extent + 0.49
      && Math.abs(other.position.x - p.x) < (direction[0] === "x" ? extent : 0.5) + 0.49
      && Math.abs(other.position.z - p.z) < (direction[0] === "z" ? extent : 0.5) + 0.49)) return null;
  }
  return { ...scene, dice: scene.dice.map((item) => item.id === id ? next : item), trail: leaveTrail ? addFootprints(scene.trail, [die, next]) : scene.trail, puzzle: null };
}
export function interpolateDice(from: readonly TeachingDie[], to: readonly TeachingDie[], progress: number): TeachingDie[] {
  const t = Math.max(0, Math.min(1, progress));
  return to.map((die) => {
    const previous = from.find((item) => item.id === die.id) ?? die;
    const offsets: TeachingDie["offsets"] = {};
    for (const face of DICE_FACES) {
      offsets[face] = (previous.offsets[face] ?? 0) * (1 - t) + (die.offsets[face] ?? 0) * t;
    }
    return { ...die, position: positionData(vector(previous.position).lerp(vector(die.position), t)), rotation: rotationData(quaternion(previous.rotation).slerp(quaternion(die.rotation), t)),
      offsets };
  });
}

export interface DiceContact { a: string; b: string; direction: DiceFace; faceA: DiceFace; faceB: DiceFace; valueA: number; valueB: number }
export function diceContacts(dice: readonly TeachingDie[]): DiceContact[] {
  const contacts: DiceContact[] = [];
  for (let i = 0; i < dice.length; i++) for (let j = i + 1; j < dice.length; j++) {
    const a = dice[i], b = dice[j];
    const direction = DICE_FACES.find((face) => vector(b.position).sub(vector(a.position)).distanceTo(vector(FACE_NORMALS[face])) < 0.025);
    if (!direction) continue;
    const faceA = worldFace(a, direction), faceB = worldFace(b, oppositeFace(direction));
    if (faceA && faceB) contacts.push({ a: a.id, b: b.id, direction, faceA, faceB, valueA: faceValue(a.hand, faceA), valueB: faceValue(b.hand, faceB) });
  }
  return contacts;
}
export function contactVisibility(dice: readonly TeachingDie[], hidden: boolean): TeachingDie[] {
  const contacts = diceContacts(dice);
  return dice.map((die) => {
    const faces = contacts.flatMap((c) => c.a === die.id ? [c.faceA] : c.b === die.id ? [c.faceB] : []);
    return { ...die, hidden: hidden ? [...new Set([...die.hidden, ...faces])] : die.hidden.filter((face) => !faces.includes(face)) };
  });
}
export type DicePuzzleResult = { ok: true; dice: TeachingDie[] } | { ok: false; reason: "no-contacts" | "impossible" | "search-limit" };
/** 总和用动态规划精确求解；逐对约束用有限域搜索，超限与无解分别反馈。 */
export function solveDicePuzzle(dice: readonly TeachingDie[], scope: DicePuzzle["scope"], target: number, random = Math.random): DicePuzzleResult {
  const contacts = diceContacts(dice);
  if (!contacts.length) return { ok: false, reason: "no-contacts" };
  if (!Number.isInteger(target) || target < 2 || target > (scope === "each" ? 12 : contacts.length * 12)) return { ok: false, reason: "impossible" };
  const offset = Math.floor(random() * 24) % 24;
  const options = dice.map((die) => DICE_ORIENTATIONS.map((_, i) => ({ ...closeDieFaces(die), rotation: DICE_ORIENTATIONS[(i + offset) % 24] })));
  if (scope === "total") {
    let sums = new Map<number, TeachingDie[]>([[0, []]]);
    for (let i = 0; i < dice.length; i++) {
      const next = new Map<number, TeachingDie[]>();
      for (const option of options[i]) {
        const score = contacts.reduce((sum, c) => sum + (c.a === option.id ? faceValue(option.hand, worldFace(option, c.direction)!) : c.b === option.id ? faceValue(option.hand, worldFace(option, oppositeFace(c.direction))!) : 0), 0);
        for (const [sum, selected] of sums) if (sum + score <= target && !next.has(sum + score)) next.set(sum + score, [...selected, option]);
      }
      sums = next;
    }
    const solution = sums.get(target);
    return solution ? { ok: true, dice: contactVisibility(solution, true) } : { ok: false, reason: "impossible" };
  }
  const assigned = new Map<string, TeachingDie>();
  let visited = 0;
  const search = (): boolean => {
    if (++visited > 50000) return false;
    if (assigned.size === dice.length) return true;
    const remaining = dice.filter((die) => !assigned.has(die.id)).sort((a, b) => contacts.filter((c) => (c.a === b.id && assigned.has(c.b)) || (c.b === b.id && assigned.has(c.a))).length
      - contacts.filter((c) => (c.a === a.id && assigned.has(c.b)) || (c.b === a.id && assigned.has(c.a))).length);
    const die = remaining[0];
    for (const option of options[dice.indexOf(die)]) {
      const valid = contacts.every((c) => {
        const other = assigned.get(c.a === die.id ? c.b : c.a);
        if (!other || (c.a !== die.id && c.b !== die.id)) return true;
        const direction = c.a === die.id ? c.direction : oppositeFace(c.direction);
        return faceValue(option.hand, worldFace(option, direction)!) + faceValue(other.hand, worldFace(other, oppositeFace(direction))!) === target;
      });
      if (!valid) continue;
      assigned.set(die.id, option);
      if (search()) return true;
      assigned.delete(die.id);
      if (visited > 50000) return false;
    }
    return false;
  };
  return search() ? { ok: true, dice: contactVisibility(dice.map((die) => assigned.get(die.id)!), true) } : { ok: false, reason: visited > 50000 ? "search-limit" : "impossible" };
}

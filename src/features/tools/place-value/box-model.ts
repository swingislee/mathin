import { Quaternion, Vector3 } from "three";
import { newId } from "@/lib/uuid";
import { spatialActionProgress } from "../spatial-interaction/policy";
import { DEFAULT_PLACE_VALUE_PRESENTATION, type PlaceValueBoard, type PlaceValueBoxStage, type PlaceValueChange, type PlaceValueGroup,
  type PlaceValueInitial, type PlaceValuePresentation, type PlaceValueSide, type PlaceValueSnapshot } from "./radix-contract";
import { PLACE_VALUE_CAMERA_TARGET, placeValueColumn, placeValueLocked, placeValueProgress } from "./radix-model";

type Vec = [number, number, number];
type Rotation = [number, number, number, number];
export interface PlaceValueBoxPart {
  key: string; unit: number; group: PlaceValueGroup; level: number; index: number;
  role: "shell" | "contents" | "mapping"; position: Vec; size: Vec; divisions: Vec; rotation: Rotation; opacity: number;
}
export const BOX_STAGES: PlaceValueBoxStage[] = ["lay", "pack", "place"];
const identity: Rotation = [0, 0, 0, 1];
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const vector = (a: Vec, b: Vec, t: number): Vec => a.map((v, i) => v + (b[i] - v) * t) as Vec;

/** 三次进位构成条、片、体，再以完整体为新单位；整数尺寸只作组成，不替换原成员。 */
export function placeValueBoxDimensions(radix: number, level: number): Vec {
  const unit = radix ** Math.floor(level / 3), remainder = level % 3;
  return [unit * (remainder === 2 ? radix : 1), unit, unit * (remainder ? radix : 1)];
}
export function placeValueBoxMappingSize(radix: number, level: number): Vec {
  const dimensions = placeValueBoxDimensions(radix, level);
  // 映射统一缩放一个完整单位，前后不冒充真实等大；薄片仍用前排层高。
  const scale = Math.min(1, 3.8 / Math.max(...dimensions));
  return dimensions.map((value) => value * scale) as Vec;
}
export function placeValueBoxMappingPosition(board: PlaceValueBoard, level: number, index: number): Vec {
  const [, height, depth] = placeValueBoxMappingSize(board.radix, level);
  return [placeValueColumn(level, board.places.length), height <= 1 ? index + .5 : height / 2 + index * (height + .16), -2.4 - depth / 2];
}
function part(board: PlaceValueBoard, level: number, index: number, role: PlaceValueBoxPart["role"]): PlaceValueBoxPart {
  const group = board.places[level][index], unit = group[0].start, mapping = role === "mapping";
  return { key: role + ":" + unit, unit, group, level, index, role, rotation: identity, opacity: 1,
    divisions: placeValueBoxDimensions(board.radix, level),
    position: mapping ? placeValueBoxMappingPosition(board, level, index) : [placeValueColumn(level, board.places.length), index + (role === "shell" ? .5 : .44), 0],
    size: mapping ? placeValueBoxMappingSize(board.radix, level) : role === "shell" ? [1, 1, 1] : [.82, .76, .82] };
}
export function placeValueBoxLayout(board: PlaceValueBoard, contents: PlaceValuePresentation["contents"] = "both") {
  return board.places.flatMap((groups, level) => groups.flatMap((_, index) => [part(board, level, index, "shell"),
    { ...part(board, level, index, "contents"), opacity: contents === "outside" ? 0 : 1 },
    { ...part(board, level, index, "mapping"), opacity: contents === "inside" ? 0 : .88 }]));
}
const blend = (a: PlaceValueBoxPart, b: PlaceValueBoxPart, t: number, lift = 0): PlaceValueBoxPart => ({ ...b,
  position: vector(a.position, b.position, t).map((value, i) => value + (i === 1 ? lift * Math.sin(Math.PI * t) : 0)) as Vec,
  size: vector(a.size, b.size, t), rotation: new Quaternion(...a.rotation).slerp(new Quaternion(...b.rotation), t).toArray() as Rotation,
  opacity: a.opacity + (b.opacity - a.opacity) * t });

export function advancePlaceValueBoxCarry(snapshot: PlaceValueSnapshot, now = Date.now()): PlaceValueSnapshot | null {
  const motion = snapshot.motion;
  if (!motion?.boxStage || motion.boxStage === "place" || placeValueProgress(motion, now) < 1) return null;
  const stage = BOX_STAGES[BOX_STAGES.indexOf(motion.boxStage) + 1];
  return { ...snapshot, motion: { ...motion, boxStage: stage, startedAt: now, progress: 0, paused: false,
    durationMs: (stage === "pack" ? 1800 : 1100) * ({ slow: 1.5, normal: 1, fast: .6 }[snapshot.speed]) } };
}
export function changePlaceValueContents(snapshot: PlaceValueSnapshot, contents: PlaceValuePresentation["contents"], now = Date.now()): PlaceValueSnapshot | null {
  if (snapshot.presentation?.strategy !== "boxes" || placeValueLocked(snapshot, now) || snapshot.presentation.contents === contents) return null;
  return { ...snapshot, presentation: { ...snapshot.presentation, contents },
    contentsMotion: { id: newId(), from: snapshot.presentation.contents, to: contents, startedAt: now, durationMs: 1500 } };
}
export function changePlaceValueStrategy(snapshot: PlaceValueSnapshot, strategy: PlaceValuePresentation["strategy"], now = Date.now()): PlaceValueSnapshot | null {
  if (placeValueLocked(snapshot, now)) return null;
  const next = { ...snapshot, presentation: { ...(snapshot.presentation ?? DEFAULT_PLACE_VALUE_PRESENTATION), strategy }, motion: null };
  delete next.contentsMotion;
  return next;
}

function childDestination(parent: PlaceValueBoxPart, child: PlaceValueBoxPart, index: number, base: number, level: number): PlaceValueBoxPart {
  const axis = (level + 1) % 3 === 1 ? 2 : (level + 1) % 3 === 2 ? 0 : 1;
  const size = [...parent.size] as Vec; size[axis] /= base;
  const position = [...parent.position] as Vec;
  position[axis] += (index - (base - 1) / 2) * size[axis] * (axis === 2 ? -1 : 1);
  return { ...child, position, size, rotation: identity, opacity: 1 };
}

/** 三段均有确定端点，等待下一步时保留刚才的姿态；只有归位段推动数位数字。 */
export function placeValueBoxCarryPose(change: PlaceValueChange, progress: number, contents: PlaceValuePresentation["contents"]): PlaceValueBoxPart[] {
  if (change.kind === "unpack") return placeValueBoxCarryPose({ ...change, kind: "carry", level: change.level - 1, before: change.after, after: change.before }, 1 - progress, contents);
  const before = placeValueBoxLayout(change.before, contents), after = placeValueBoxLayout(change.after, contents);
  if (progress <= 0) return before;
  if (progress >= 1) return after;
  const t = spatialActionProgress(progress);
  if (change.kind !== "carry") {
    const starts = new Map(before.map((item) => [item.key, item])), ends = new Set(after.map((item) => item.key));
    return [...after.map((item) => blend(starts.get(item.key) ?? { ...item, position: [item.position[0], item.position[1] + 1.5, item.position[2]], opacity: 0 }, item, t)),
      ...before.filter((item) => !ends.has(item.key)).map((item) => ({ ...item, opacity: item.opacity * (1 - t) }))];
  }
  const base = change.before.radix, groups = change.before.places[change.level].slice(-base), sourceIds = new Set(groups.map((g) => g[0].start));
  const parentIndex = change.after.places[change.level + 1].findIndex((g) => g.some((span) => groups[0][0].start >= span.start && groups[0][0].start < span.start + span.count));
  if (parentIndex < 0) return before;
  const parent = part(change.after, change.level + 1, parentIndex, "mapping");
  const inside = part(change.after, change.level + 1, parentIndex, "contents"), shell = part(change.after, change.level + 1, parentIndex, "shell");
  const stagedInside = { ...inside, position: [inside.position[0], inside.position[1] + .8, -1.35] as Vec };
  const stagedShell = { ...shell, position: [shell.position[0], shell.position[1] + .8, -1.35] as Vec };
  const stage = Math.min(2, Math.floor(progress * 3)), local = spatialActionProgress(clamp(progress * 3 - stage));
  const sources = groups.map((_, i) => ({ ...part(change.before, change.level, change.before.places[change.level].length - base + i, contents === "inside" ? "contents" : "mapping"), opacity: contents === "inside" ? 1 : .88 }));
  const sourceCenter = vector(sources[0].position, sources.at(-1)!.position, .5);
  const starts = new Map(before.map((item) => [item.key, item]));
  const result = after.filter((item) => !(item.unit === parent.unit && item.level === parent.level)).map((item) => blend(starts.get(item.key) ?? item, item, t));
  for (let i = 0; i < groups.length; i++) {
    const source = sources[i];
    const laid = childDestination(parent, source, i, base, change.level);
    const packed = childDestination(stagedInside, source, i, base, change.level);
    const placed = childDestination(inside, source, i, base, change.level);
    if (stage === 0) {
      const axis = (change.level + 1) % 3;
      // 先收齐间隙，再把整组倒下；各块共用转轴和角度，避免各自直线插值造成挤穿。
      const gathered = { ...source, position: [sourceCenter[0], sourceCenter[1] + (i - (base - 1) / 2) * source.size[1], sourceCenter[2]] as Vec };
      if (local < .22) result.push({ ...blend(source, gathered, spatialActionProgress(local / .22)), key: "carrying:" + source.unit });
      else {
        const fold = spatialActionProgress((local - .22) / .78), targetAxis = axis === 1 ? 2 : axis === 2 ? 0 : 1;
        const rotation = new Quaternion().setFromAxisAngle(new Vector3(axis === 1 ? 1 : 0, 0, axis === 1 ? 0 : 1), (axis ? -Math.PI / 2 : 0) * fold);
        const pitch = source.size[1] + (laid.size[targetAxis] - source.size[1]) * fold;
        const localPosition = new Vector3(0, (i - (base - 1) / 2) * pitch, 0).applyQuaternion(rotation);
        const center = vector(sourceCenter, parent.position, fold);
        result.push({ ...blend(source, laid, fold), key: "carrying:" + source.unit, rotation: rotation.toArray() as Rotation,
          position: [center[0] + localPosition.x, center[1] + localPosition.y + .6 * Math.sin(Math.PI * fold), center[2] + localPosition.z] });
      }
    } else if (stage === 1) result.push({ ...blend(laid, packed, local, 1), key: "carrying:" + source.unit });
    else result.push({ ...blend(packed, placed, local, .5), key: "carrying:" + source.unit, opacity: contents === "outside" ? 1 - local : 1 });
  }
  if (stage === 0) result.push(...before.filter((item) => sourceIds.has(item.unit) && (item.role === "shell" || (contents === "both" && item.role === "contents"))).map((item) => ({ ...item, opacity: item.opacity * (1 - local) })));
  // 同时展示是同一组的映射影像，既不新增成员，也不进入数学总数。
  if (contents !== "inside" && stage >= 1) result.push({ ...parent, key: "mapping-parent:" + parent.unit, opacity: .88 * (stage === 1 ? local : 1) });
  if (stage >= 1) result.push(stage === 1 ? { ...stagedShell, opacity: local } : blend(stagedShell, shell, local, .5));
  return result;
}

export function placeValueBoxPose(snapshot: PlaceValueSnapshot, side: PlaceValueSide, progress: number, contentsProgress = 1) {
  const mode = snapshot.presentation?.contents ?? "both", motion = snapshot.motion?.side === side ? snapshot.motion : null;
  if (motion) {
    const position = motion.boxStage ? (BOX_STAGES.indexOf(motion.boxStage) + progress) / 3 : progress;
    if (position < 1) return placeValueBoxCarryPose(motion, position, mode);
  }
  const after = placeValueBoxLayout(snapshot[side], mode), contentsMotion = snapshot.contentsMotion;
  if (!contentsMotion || contentsProgress >= 1) return after;
  const before = new Map(placeValueBoxLayout(snapshot[side], contentsMotion.from).map((item) => [item.key, item]));
  const t = spatialActionProgress(contentsProgress);
  return after.map((item) => {
    const old = before.get(item.key)!;
    if (item.role !== "mapping") return blend(old, item, t);
    const inner = before.get("contents:" + item.unit)!;
    const from = old.opacity === 0 ? { ...old, position: inner.position, size: inner.size } : old;
    const to = item.opacity === 0 ? { ...item, position: inner.position, size: inner.size } : item;
    return blend(from, to, t, 1.2);
  });
}

export function placeValueBoxFrame(snapshot: Pick<PlaceValueInitial, "left" | "right" | "mode" | "view">): PlaceValueInitial["frame"] {
  const digits = snapshot.left.places.length, width = snapshot.mode === "compare" ? digits * 5 + 2 : (digits - 1) * 2.5 + 2;
  const items = [snapshot.left, ...(snapshot.mode === "compare" ? [snapshot.right] : [])].flatMap((board) => placeValueBoxLayout(board));
  const visible = snapshot.view === "front" ? items.filter((item) => item.role !== "mapping") : items;
  const height = Math.max(8.5, snapshot.left.radix - 3, ...visible.map((item) => item.position[1] + item.size[1] / 2 - 3));
  return { center: { ...PLACE_VALUE_CAMERA_TARGET }, radius: Math.max(8.5, width * .82, height, snapshot.view === "front" ? 0 : Math.hypot(width * .65, height, 6)) };
}

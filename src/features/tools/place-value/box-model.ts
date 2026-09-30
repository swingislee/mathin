import { Quaternion, Vector3 } from "three";
import { newId } from "@/lib/uuid";
import { spatialActionProgress } from "../spatial-interaction/policy";
import { DEFAULT_PLACE_VALUE_PRESENTATION, type PlaceValueBoard, type PlaceValueChange, type PlaceValueGroup,
  type PlaceValueInitial, type PlaceValuePresentation, type PlaceValueSide, type PlaceValueSnapshot } from "./radix-contract";
import { PLACE_VALUE_CAMERA_TARGET, isPlaceValueRegrouping, placeValueColumn, placeValueLocked, placeValueOffset, placeValueRedSpans } from "./radix-model";

type Vec = [number, number, number];
type Rotation = [number, number, number, number];
type Contents = PlaceValuePresentation["contents"];
export interface PlaceValueBoxPart {
  key: string; unit: number; group: PlaceValueGroup; level: number; index: number;
  role: "shell" | "contents" | "mapping"; position: Vec; size: Vec; divisions: Vec; rotation: Rotation; opacity: number;
  /** 收纳时前端始终是一个单位；取出后才逐渐显示完整组成的前端分格。 */
  detail: number; frontTone: number;
}
const identity: Rotation = [0, 0, 0, 1];
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const vector = (a: Vec, b: Vec, t: number): Vec => a.map((v, i) => v + (b[i] - v) * t) as Vec;
const contains = (group: PlaceValueGroup, unit: number) => group.some((span) => unit >= span.start && unit < span.start + span.count);

/** 三次进位构成条、片、体，再以完整体为新单位；整数尺寸只作组成，不替换原成员。 */
export function placeValueBoxDimensions(radix: number, level: number): Vec {
  const unit = radix ** Math.floor(level / 3), remainder = level % 3;
  return [unit * (remainder === 2 ? radix : 1), unit, unit * (remainder ? radix : 1)];
}
export function placeValueBoxMappingSize(radix: number, level: number): Vec {
  // 只有计数盒内使用压缩表示；取出与拼合保留每个一的原始尺寸。
  return placeValueBoxDimensions(radix, level);
}
export function placeValueBoxMappingPosition(board: PlaceValueBoard, level: number, index: number): Vec {
  const [, height, depth] = placeValueBoxMappingSize(board.radix, level);
  // 兼容旧场景的整列同时展开：各列沿深度错开，原尺寸的片／体互不穿插。
  const precedingDepth = board.places.slice(0, level).reduce((sum, groups, previous) =>
    sum + (groups.length ? placeValueBoxMappingSize(board.radix, previous)[2] + 1 : 0), 0);
  return [placeValueColumn(level, board.places.length), height * (index + .5), -2.4 - precedingDepth - depth / 2];
}
function part(board: PlaceValueBoard, level: number, index: number, role: PlaceValueBoxPart["role"]): PlaceValueBoxPart {
  const group = board.places[level][index], unit = group[0].start, mapping = role === "mapping";
  return { key: role + ":" + unit, unit, group, level, index, role, rotation: identity, opacity: 1,
    detail: mapping ? 1 : 0, frontTone: Math.floor(index / 5) % 2, divisions: placeValueBoxDimensions(board.radix, level),
    position: mapping ? placeValueBoxMappingPosition(board, level, index) : [placeValueColumn(level, board.places.length), index + (role === "shell" ? .5 : .44), 0],
    size: mapping ? placeValueBoxMappingSize(board.radix, level) : role === "shell" ? [1, 1, 1] : [.82, .76, .82] };
}
/** undefined 保留旧场景的整体观察；新操作传入明确选中的单位，其他盒子继续收纳。 */
export function placeValueBoxLayout(board: PlaceValueBoard, contents: Contents = "inside", unit?: number) {
  return board.places.flatMap((groups, level) => groups.flatMap((group, index) => {
    const mode = unit === undefined || contains(group, unit) ? contents : "inside";
    const inner = part(board, level, index, "contents"), outer = part(board, level, index, "mapping");
    if (unit !== undefined && contains(group, unit)) {
      // 单盒取出留在这一盒后方，底部对齐其层高；其余计数盒保持原尺度。
      outer.position = [outer.position[0], index + outer.size[1] / 2, -2.4 - outer.size[2] / 2];
    }
    return [part(board, level, index, "shell"),
      // 取出时移动同一份内容，盒子留空；只有明确选择「同时展示」才生成映射副本。
      mode === "outside" ? { ...outer, key: inner.key, role: inner.role } : inner,
      { ...outer, opacity: mode === "both" ? .88 : 0 }];
  }));
}
const blend = (a: PlaceValueBoxPart, b: PlaceValueBoxPart, t: number, lift = 0): PlaceValueBoxPart => ({ ...b,
  position: vector(a.position, b.position, t).map((value, i) => value + (i === 1 ? lift * Math.sin(Math.PI * t) : 0)) as Vec,
  size: vector(a.size, b.size, t), rotation: new Quaternion(...a.rotation).slerp(new Quaternion(...b.rotation), t).toArray() as Rotation,
  opacity: a.opacity + (b.opacity - a.opacity) * t, detail: a.detail + (b.detail - a.detail) * t,
  frontTone: a.frontTone + (b.frontTone - a.frontTone) * t });

/** 早期开发课堂的分段命令继续走向同一个终点，不再等待第二、第三次点击。 */
export function normalizePlaceValueBoxSnapshot(snapshot: PlaceValueSnapshot): PlaceValueSnapshot {
  const motion = snapshot.motion;
  if (snapshot.presentation?.strategy !== "boxes" || !motion?.boxStage) return snapshot;
  const { boxStage, ...rest } = motion;
  const start = boxStage === "lay" ? 0 : boxStage === "pack" ? .6 : 1;
  const span = boxStage === "lay" ? .6 : boxStage === "pack" ? .4 : 0;
  return { ...snapshot, motion: { ...rest, paused: false, durationMs: span ? Math.min(60_000, motion.durationMs / span) : motion.durationMs,
    progress: start + motion.progress * span } };
}
export function changePlaceValueContents(snapshot: PlaceValueSnapshot, contents: Contents, now = Date.now()): PlaceValueSnapshot | null {
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
  return { ...child, position, size, rotation: identity, opacity: 1, detail: parent.detail, frontTone: parent.frontTone };
}

/** 一次进位：展开原单位、倒下／叠合、直接装入目标盒；阶段属于同一条动画。 */
export function placeValueBoxCarryPose(change: PlaceValueChange, progress: number, contents: Contents, unit?: number): PlaceValueBoxPart[] {
  if (change.kind === "unpack") return placeValueBoxCarryPose({ ...change, kind: "carry", level: change.level - 1, before: change.after, after: change.before }, 1 - progress, contents, unit);
  const before = placeValueBoxLayout(change.before, contents, unit), after = placeValueBoxLayout(change.after, contents, unit);
  if (progress <= 0) return before;
  if (progress >= 1) return after;
  const t = spatialActionProgress(progress);
  if (change.kind !== "carry") {
    const starts = new Map(before.map((item) => [item.key, item])), ends = new Set(after.map((item) => item.key));
    return [...after.map((item) => blend(starts.get(item.key) ?? { ...item, position: [item.position[0], item.position[1] + 1.5, item.position[2]], opacity: 0 }, item, t)),
      ...before.filter((item) => !ends.has(item.key)).map((item) => ({ ...item, opacity: item.opacity * (1 - t) }))];
  }
  const base = change.before.radix, groups = change.before.places[change.level].slice(-base), sourceIds = new Set(groups.map((g) => g[0].start));
  const parentIndex = change.after.places[change.level + 1].findIndex((g) => contains(g, groups[0][0].start));
  if (parentIndex < 0) return before;
  const parentUnit = change.after.places[change.level + 1][parentIndex][0].start;
  const parent = after.find((item) => item.role === "mapping" && item.unit === parentUnit)!;
  const target = after.find((item) => item.role === "contents" && item.unit === parent.unit)!;
  const shell = after.find((item) => item.role === "shell" && item.unit === parent.unit)!;
  const mapping = after.find((item) => item.role === "mapping" && item.unit === parent.unit)!;
  const open = spatialActionProgress(clamp(progress / .16)), fold = spatialActionProgress(clamp((progress - .16) / .4));
  // .56–.60 是同一播放中的短停留，让老师看清组成后再压缩。
  const pack = spatialActionProgress(clamp((progress - .6) / .4)), fuse = spatialActionProgress(clamp((progress - .91) / .09));
  const sources = groups.map((_, i) => before.find((item) => item.role === "contents" && item.unit === groups[i][0].start)!);
  const expanded = sources.map((source) => ({ ...part(change.before, change.level, source.index, "mapping"), key: source.key, role: source.role }));
  const sourceCenter = vector(expanded[0].position, expanded.at(-1)!.position, .5);
  const sourcePitch = expanded[1].position[1] - expanded[0].position[1];
  const starts = new Map(before.map((item) => [item.key, item]));
  const result = after.filter((item) => !(item.unit === parent.unit && item.level === parent.level)).map((item) => blend(starts.get(item.key) ?? item, item, t));
  const axis = (change.level + 1) % 3, rotationAxis = new Vector3(axis === 1 ? 1 : 0, 0, axis === 1 ? 0 : 1);
  const targetAxis = axis === 1 ? 2 : axis === 2 ? 0 : 1;
  const finalRotation = new Quaternion().setFromAxisAngle(rotationAxis, axis ? -Math.PI / 2 : 0);
  const laidPose = (destination: PlaceValueBoxPart): PlaceValueBoxPart => {
    const size = [...destination.size] as Vec;
    if (axis) [size[1], size[targetAxis]] = [size[targetAxis], size[1]];
    return { ...destination, size, rotation: finalRotation.toArray() as Rotation };
  };
  // 先移动／压缩拼好的整体，再由整体计算每块的位置与局部尺寸；装盒不再逐块转回。
  const packed = blend(parent, target, pack, .7);
  for (let i = 0; i < groups.length; i++) {
    const source = sources[i], full = expanded[i];
    const laid = childDestination(parent, source, i, base, change.level);
    let moving: PlaceValueBoxPart;
    if (progress < .16) moving = blend(source, full, open);
    else if (progress < .6) {
      const rotation = new Quaternion().slerp(finalRotation, fold);
      const pitch = sourcePitch + (laid.size[targetAxis] - sourcePitch) * fold;
      // 逐步收齐低位层间间距，各块共用转轴，保持整组倒下的关系。
      const offset = (i - (base - 1) / 2) * pitch;
      const local = new Vector3(0, offset, 0).applyQuaternion(rotation), center = vector(sourceCenter, parent.position, fold);
      moving = { ...blend(full, laidPose(laid), fold), rotation: rotation.toArray() as Rotation,
        position: [center[0] + local.x, center[1] + local.y + .5 * Math.sin(Math.PI * fold), center[2] + local.z] };
    } else moving = { ...laidPose(childDestination(packed, source, i, base, change.level)), opacity: 1 - fuse };
    result.push({ ...moving, key: "carrying:" + source.unit });
  }
  result.push(...before.filter((item) => sourceIds.has(item.unit) && item.role !== "contents").map((item) => ({ ...item, opacity: item.opacity * (1 - open) })));
  // 盒壳直接在高一位的最终位置出现，内容装好后不再有「归位」操作或后方残留。
  result.push({ ...shell, opacity: spatialActionProgress(clamp((progress - .5) / .1)) }, { ...packed, opacity: fuse }, { ...mapping, opacity: mapping.opacity * fuse });
  return result;
}

export function placeValueBoxPose(snapshot: PlaceValueSnapshot, side: PlaceValueSide, progress: number, contentsProgress = 1) {
  const scope = snapshot.selection, mode = scope && scope.side !== side ? "inside" : snapshot.presentation?.contents ?? "inside";
  const unit = scope?.side === side ? scope.unit : undefined, motion = snapshot.motion?.side === side ? snapshot.motion : null;
  if (motion && progress < 1) return placeValueBoxCarryPose(motion, progress, mode, unit);
  const after = placeValueBoxLayout(snapshot[side], mode, unit), contentsMotion = snapshot.contentsMotion;
  if (!contentsMotion || contentsProgress >= 1) return after;
  const oldMode = scope && scope.side !== side ? "inside" : contentsMotion.from;
  const before = new Map(placeValueBoxLayout(snapshot[side], oldMode, unit).map((item) => [item.key, item]));
  const t = spatialActionProgress(contentsProgress);
  return after.map((item) => {
    const old = before.get(item.key)!;
    if (item.role !== "mapping") return blend(old, item, t, item.role === "contents" && item.position.some((value, i) => value !== old.position[i]) ? 1.2 : 0);
    const inner = before.get("contents:" + item.unit)!;
    const from = old.opacity === 0 ? { ...old, position: inner.position, size: inner.size } : old;
    const to = item.opacity === 0 ? { ...item, position: inner.position, size: inner.size } : item;
    return blend(from, to, t, 1.2);
  });
}

/** 红色只提醒待进位；播放后使用原配色，不把一个红成员扩散到整组或新单位。 */
export function placeValueBoxRedSpans(snapshot: PlaceValueSnapshot, side: PlaceValueSide, progress: number) {
  return snapshot.motion?.side === side && isPlaceValueRegrouping(snapshot.motion.kind) && progress < 1 ? [] : placeValueRedSpans(snapshot, side, progress);
}

export function placeValueBoxFrame(snapshot: Pick<PlaceValueInitial, "left" | "right" | "mode" | "view"> & Partial<Pick<PlaceValueInitial, "presentation" | "selection">>): PlaceValueInitial["frame"] {
  const digits = snapshot.left.places.length, width = snapshot.mode === "compare" ? digits * 5 + 2 : (digits - 1) * 2.5 + 2;
  const sides: PlaceValueSide[] = snapshot.mode === "compare" ? ["left", "right"] : ["left"];
  const visible = sides.flatMap((side) => {
    const scope = snapshot.selection, contents = scope && scope.side !== side ? "inside" : snapshot.presentation?.contents ?? "inside";
    return placeValueBoxLayout(snapshot[side], contents, scope?.side === side ? scope.unit : undefined)
      .filter((item) => item.opacity > 0).map((item) => ({ ...item, position: [item.position[0] + placeValueOffset(snapshot.mode, side, digits), item.position[1], item.position[2]] as Vec }));
  });
  // 适应视图只包住当前可见内容，收纳时不因隐藏的原尺寸组成而拉远前排计数盒。
  const x = Math.max(width * .65, ...visible.map((item) => Math.abs(item.position[0]) + item.size[0] / 2));
  const y = Math.max(8.5, snapshot.left.radix - 3, ...visible.map((item) => Math.abs(item.position[1] - PLACE_VALUE_CAMERA_TARGET.y) + item.size[1] / 2));
  const z = Math.max(6, ...visible.map((item) => Math.abs(item.position[2]) + item.size[2] / 2));
  const radius = snapshot.view === "front" ? Math.max(x, y) : snapshot.view === "left" || snapshot.view === "right" ? Math.max(y, z) : snapshot.view === "top" ? Math.max(x, z) : Math.hypot(x, y, z);
  return { center: { ...PLACE_VALUE_CAMERA_TARGET }, radius: Math.max(8.5, width * .82, radius) };
}

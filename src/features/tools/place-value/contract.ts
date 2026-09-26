import { z } from "zod";

export const PLACE_VALUE_VERSION = "place-value-lesson-v1" as const;
export const PLACE_VALUE_LIMIT = 999;
export const PLACE_VALUE_HISTORY_LIMIT = 12;
export const PLACE_VALUE_ACTIONS = ["add", "remove", "carry-one", "carry-ten", "unpack-ten", "unpack-hundred", "replace"] as const;
const unit = z.number().int().min(0).max(1_999_999);
const ten = z.array(unit).length(10);
const hundred = z.array(ten).length(10);
/** 单位身份使用场景内递增序号；最低位保留黄/蓝色，进退位不改变身份或颜色。 */
export const placeValueBoardSchema = z.object({
  ones: z.array(unit).max(PLACE_VALUE_LIMIT),
  tens: z.array(ten).max(99),
  hundreds: z.array(hundred).max(9),
  nextId: z.number().int().min(0).max(1_000_000),
}).strict().superRefine((board, ctx) => {
  const ids = [...board.ones, ...board.tens.flat(), ...board.hundreds.flat(2)];
  if (ids.length > PLACE_VALUE_LIMIT || new Set(ids.map((id) => Math.floor(id / 2))).size !== ids.length || ids.some((id) => id >= board.nextId * 2)) {
    ctx.addIssue({ code: "custom", message: "Units must be unique, allocated once, and within the number range" });
  }
});
export type PlaceValueBoard = z.infer<typeof placeValueBoardSchema>;
export type PlaceValueAction = (typeof PLACE_VALUE_ACTIONS)[number];
export type PlaceValueSide = "left" | "right";
export type PlaceValuePlace = "hundreds" | "tens" | "ones";
const side = z.enum(["left", "right"]);
const selection = z.object({ side, unit }).strict().nullable();
const coordinate = z.number().finite().min(-2000).max(2000);
const fields = {
  mode: z.enum(["single", "compare"]),
  left: placeValueBoardSchema, right: placeValueBoardSchema, active: side, selection,
  highlight: z.enum(["all", "hundreds", "tens", "ones"]),
  comparison: z.enum(["hidden", "<", "=", ">"]),
  autoCarry: z.boolean(), speed: z.enum(["slow", "normal", "fast"]),
  showDigits: z.boolean(), showLabels: z.boolean(), grid: z.boolean(), axes: z.boolean(),
  view: z.enum(["angle", "front", "left", "right", "top"]),
  frame: z.object({ center: z.object({ x: coordinate, y: coordinate, z: coordinate }).strict(), radius: z.number().finite().min(1).max(1500) }).strict(),
};
function selectionExists(value: { left: PlaceValueBoard; right: PlaceValueBoard; selection: z.infer<typeof selection> }, ctx: z.RefinementCtx) {
  if (!value.selection) return;
  const board = value[value.selection.side];
  if (![...board.ones, ...board.tens.flat(), ...board.hundreds.flat(2)].includes(value.selection.unit)) {
    ctx.addIssue({ code: "custom", path: ["selection"], message: "Selection must reference an existing unit" });
  }
}
export const placeValueInitialSchema = z.object(fields).strict().superRefine(selectionExists);
export type PlaceValueInitial = z.infer<typeof placeValueInitialSchema>;
const changeFields = { side, kind: z.enum(PLACE_VALUE_ACTIONS), before: placeValueBoardSchema, after: placeValueBoardSchema };
export const placeValueChangeSchema = z.object(changeFields).strict();
export type PlaceValueChange = z.infer<typeof placeValueChangeSchema>;
export const placeValueMotionSchema = z.object({
  ...changeFields, id: z.string().uuid(), startedAt: z.number().int().min(0).max(10_000_000_000_000),
  durationMs: z.number().finite().min(1).max(60_000), progress: z.number().finite().min(0).max(1), paused: z.boolean(),
}).strict();
export type PlaceValueMotion = z.infer<typeof placeValueMotionSchema>;
export const placeValueSnapshotSchema = z.object({
  ...fields, cameraRevision: z.number().int().min(0).max(1_000_000),
  motion: placeValueMotionSchema.nullable(),
  past: z.array(placeValueChangeSchema).max(PLACE_VALUE_HISTORY_LIMIT), future: z.array(placeValueChangeSchema).max(PLACE_VALUE_HISTORY_LIMIT),
}).strict().superRefine((value, ctx) => {
  selectionExists(value, ctx);
  const motion = value.motion;
  if (motion && JSON.stringify(value[motion.side]) !== JSON.stringify(motion.after)) ctx.addIssue({ code: "custom", path: ["motion"], message: "Motion must end at the authoritative grouping" });
  for (const change of [...value.past, ...value.future, ...(motion ? [motion] : [])]) {
    if (!validPlaceValueChange(change)) ctx.addIssue({ code: "custom", path: ["motion"], message: "Invalid regrouping or lost unit identity" });
  }
});
export type PlaceValueSnapshot = z.infer<typeof placeValueSnapshotSchema>;
export const placeValueToolSchema = z.object({
  toolId: z.literal("place-value"), contentVersion: z.literal(PLACE_VALUE_VERSION),
  payload: z.object({ title: z.string().trim().min(1).max(80), initial: placeValueInitialSchema }).strict(),
}).strict();
export function boardUnits(board: PlaceValueBoard): number[] { return [...board.hundreds.flat(2), ...board.tens.flat(), ...board.ones]; }
export function boardTotal(board: PlaceValueBoard): number { return board.ones.length + board.tens.length * 10 + board.hundreds.length * 100; }
export function createPlaceValueBoard(value: number, grouping: "normal" | "ones" | "tens" = "normal"): PlaceValueBoard {
  const count = Math.max(0, Math.min(PLACE_VALUE_LIMIT, Math.round(Number.isFinite(value) ? value : 0)));
  const board: PlaceValueBoard = { ones: Array.from({ length: count }, (_, index) => index * 2 + (index % 10 < 5 ? 0 : 1)), tens: [], hundreds: [], nextId: count };
  if (grouping === "ones") return board;
  while (board.ones.length >= 10) board.tens.push(board.ones.splice(0, 10));
  if (grouping === "normal") while (board.tens.length >= 10) board.hundreds.push(board.tens.splice(0, 10));
  return board;
}
export function createDefaultPlaceValueInitial(): PlaceValueInitial {
  return { mode: "single", left: createPlaceValueBoard(9), right: createPlaceValueBoard(20), active: "left", selection: null,
    highlight: "all", comparison: "hidden", autoCarry: false, speed: "normal", showDigits: true, showLabels: true, grid: true, axes: false,
    view: "front", frame: { center: { x: 0, y: 4, z: -3 }, radius: 8.5 } };
}
export function placeValueSnapshot(initial: PlaceValueInitial): PlaceValueSnapshot {
  return { ...placeValueInitialSchema.parse(structuredClone(initial)), cameraRevision: 0, motion: null, past: [], future: [] };
}
export function placeValueInitial(snapshot: PlaceValueSnapshot): PlaceValueInitial {
  const initial = Object.fromEntries(Object.keys(fields).map((key) => [key, snapshot[key as keyof typeof fields]]));
  return placeValueInitialSchema.parse(structuredClone(initial));
}
/** 同时校验动作数量与具体成员；相同总数并不足以证明一次进位合法。 */
export function validPlaceValueChange(change: PlaceValueChange): boolean {
  if (change.kind === "replace") return true;
  const before = change.before, after = change.after;
  const copy = structuredClone(before);
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (change.kind === "add") {
    if (after.ones.length !== before.ones.length + 1) return false;
    const added = after.ones.at(-1)!;
    if (added !== before.nextId * 2 + (before.ones.length % 10 < 5 ? 0 : 1)) return false;
    copy.ones.push(added); copy.nextId++;
  } else if (change.kind === "remove") {
    if (!copy.ones.length) return false;
    copy.ones.pop();
    // 撤销添加可回收最后分配的序号，普通减一保留序号。
    if (after.nextId === before.nextId - 1 && Math.floor(before.ones.at(-1)! / 2) === after.nextId) copy.nextId--;
  } else if (change.kind === "carry-one") {
    if (copy.ones.length < 10) return false;
    const group = after.tens.find((t) => !before.tens.some((p) => same(p, t)));
    if (!group || !same(group, copy.ones.slice(-10))) return false;
    copy.ones.splice(-10); copy.tens = after.tens;
    if (!same(copy.tens.filter((t) => t !== group), before.tens)) return false;
  } else if (change.kind === "carry-ten") {
    if (copy.tens.length < 10) return false;
    const group = after.hundreds.find((h) => !before.hundreds.some((p) => same(p, h)));
    if (!group || !same(group, copy.tens.slice(-10))) return false;
    copy.tens.splice(-10); copy.hundreds = after.hundreds;
    if (!same(copy.hundreds.filter((h) => h !== group), before.hundreds)) return false;
  } else if (change.kind === "unpack-ten") {
    const removed = before.tens.findIndex((t) => !after.tens.some((p) => same(p, t)));
    if (removed < 0) return false;
    copy.ones.push(...copy.tens.splice(removed, 1)[0]);
  } else {
    const removed = before.hundreds.findIndex((h) => !after.hundreds.some((p) => same(p, h)));
    if (removed < 0) return false;
    copy.tens.push(...copy.hundreds.splice(removed, 1)[0]);
  }
  return same(copy, after);
}

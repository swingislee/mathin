import { z } from "zod";
import { PLACE_VALUE_COLOR_PERIOD, placeValueColorPhase } from "./color-policy";

export const PLACE_VALUE_VERSION = "place-value-lesson-v2" as const;
export const PLACE_VALUE_BASES = [2, 3, 4, 5, 7, 8, 9, 10, 16] as const;
export const PLACE_VALUE_MAX_DIGITS = 6;
export const PLACE_VALUE_HISTORY_LIMIT = 12;
export const PLACE_VALUE_MAX_GROUPS = 2048;
export type PlaceValueSide = "left" | "right";
export type PlaceValuePlace = number;
export const placeValueLimit = (base: number, digits: number) => base ** digits - 1;
export const groupSize = (group: PlaceValueGroup) => group.reduce((sum, span) => sum + span.count, 0);
export const digitSymbol = (digit: number) => digit.toString(16).toUpperCase();
export const formatPlaceValue = (value: number, base: number) => value.toString(base).toUpperCase();
export function parsePlaceValue(text: string, base: number): number | null {
  const value = text.trim().toUpperCase();
  if (!value || !/^[0-9A-F]+$/.test(value) || [...value].some((c) => parseInt(c, 16) >= base)) return null;
  const result = parseInt(value, base);
  return Number.isSafeInteger(result) ? result : null;
}
const integer = z.number().int().min(0).max(1_000_000_000_000);
/** 连续单位身份和颜色相位；无论表示多少个一，都不展开为同等长度的数组。 */
const spanSchema = z.object({ start: integer, count: z.number().int().min(1).max(16 ** 6), phase: z.number().int().min(0).max(15) }).strict();
export type PlaceValueSpan = z.infer<typeof spanSchema>;
export type PlaceValueGroup = PlaceValueSpan[];
export function compactSpans(spans: PlaceValueSpan[], radix = PLACE_VALUE_COLOR_PERIOD): PlaceValueGroup {
  const result: PlaceValueSpan[] = [];
  for (const span of spans) {
    const last = result.at(-1);
    if (last && last.start + last.count === span.start && (last.phase + last.count) % radix === span.phase) last.count += span.count;
    else result.push({ ...span });
  }
  return result;
}
export function sliceGroup(group: PlaceValueGroup, start: number, count: number, radix = PLACE_VALUE_COLOR_PERIOD): PlaceValueGroup {
  let cursor = 0;
  return group.flatMap((span) => {
    const from = Math.max(start, cursor), to = Math.min(start + count, cursor + span.count), offset = from - cursor;
    cursor += span.count;
    return to > from ? [{ start: span.start + offset, count: to - from, phase: (span.phase + offset) % radix }] : [];
  });
}
export const placeValueBoardSchema = z.object({
  radix: z.union(PLACE_VALUE_BASES.map((base) => z.literal(base))),
  places: z.array(z.array(z.array(spanSchema).min(1).max(2048)).max(PLACE_VALUE_MAX_GROUPS)).min(3).max(PLACE_VALUE_MAX_DIGITS),
  nextId: integer,
}).strict().superRefine((board, ctx) => {
  const spans = board.places.flat(2).sort((a, b) => a.start - b.start);
  const valid = spans.length <= 4096 && board.places.flat().length <= PLACE_VALUE_MAX_GROUPS
    && boardTotal(board) <= placeValueLimit(board.radix, board.places.length)
    && board.places.every((groups, level) => groups.every((group) => groupSize(group) === board.radix ** level))
    && spans.every((span, i) => span.start + span.count <= board.nextId
      && (!i || spans[i - 1].start + spans[i - 1].count <= span.start));
  if (!valid) ctx.addIssue({ code: "custom", message: "Invalid place weights, unit ranges, allocation or representation budget" });
});
export type PlaceValueBoard = z.infer<typeof placeValueBoardSchema>;
export const boardTotal = (board: PlaceValueBoard) => board.places.reduce((sum, groups, level) => sum + groups.length * board.radix ** level, 0);
export const boardHasUnit = (board: PlaceValueBoard, id: number) => board.places.some((groups) => groups.some((group) => group.some((span) => id >= span.start && id < span.start + span.count)));
export function createPlaceValueBoard(value: number, grouping: "normal" | "ones" | "tens" = "normal", radix = 10, digits = 3): PlaceValueBoard {
  if (!PLACE_VALUE_BASES.some((base) => base === radix) || !Number.isInteger(digits) || digits < 3 || digits > PLACE_VALUE_MAX_DIGITS
    || !Number.isInteger(value) || value < 0 || value > placeValueLimit(radix, digits)) throw new Error("PLACE_VALUE_RANGE");
  const places: PlaceValueGroup[][] = Array.from({ length: digits }, () => []);
  let remaining = value, nextId = 0;
  for (let level = grouping === "ones" ? 0 : grouping === "tens" ? 1 : digits - 1; level >= 0; level--) {
    const weight = radix ** level, count = Math.floor(remaining / weight);
    if (count + places.flat().length > PLACE_VALUE_MAX_GROUPS) throw new Error("PLACE_VALUE_GROUP_BUDGET");
    for (let index = 0; index < count; index++) {
      places[level].push([{ start: nextId, count: weight, phase: level ? 0 : placeValueColorPhase(index) }]); nextId += weight;
    }
    remaining %= weight;
  }
  return placeValueBoardSchema.parse({ radix, places, nextId });
}
export type PlaceValueAction = "add" | "remove" | "carry" | "unpack" | "replace";
const side = z.enum(["left", "right"]), level = z.number().int().min(0).max(PLACE_VALUE_MAX_DIGITS - 1);
const fields = {
  mode: z.enum(["single", "compare"]), left: placeValueBoardSchema, right: placeValueBoardSchema, active: side,
  selection: z.object({ side, unit: integer }).strict().nullable(), highlight: z.union([z.literal("all"), level]),
  comparison: z.enum(["hidden", "<", "=", ">"]), autoCarry: z.boolean(), speed: z.enum(["slow", "normal", "fast"]),
  showDigits: z.boolean(), showLabels: z.boolean(), grid: z.boolean(), axes: z.boolean(),
  view: z.enum(["angle", "front", "left", "right", "top"]),
  frame: z.object({ center: z.object({ x: z.number().finite().min(-50).max(50), y: z.number().finite().min(-50).max(50), z: z.number().finite().min(-50).max(50) }).strict(), radius: z.number().finite().min(1).max(10_000_000) }).strict(),
};
type InitialFields = z.infer<z.ZodObject<typeof fields>>;
function validateInitial(value: InitialFields, ctx: z.RefinementCtx) {
  if (value.left.radix !== value.right.radix || value.left.places.length !== value.right.places.length
    || (value.highlight !== "all" && value.highlight >= value.left.places.length)
    || (value.selection && !boardHasUnit(value[value.selection.side], value.selection.unit))) ctx.addIssue({ code: "custom", message: "Mismatched base, places or selection" });
}
export const placeValueInitialSchema = z.object(fields).strict().superRefine(validateInitial);
export type PlaceValueInitial = z.infer<typeof placeValueInitialSchema>;
const changeFields = { side, kind: z.enum(["add", "remove", "carry", "unpack", "replace"]), level,
  before: placeValueBoardSchema, after: placeValueBoardSchema };
export const placeValueChangeSchema = z.object(changeFields).strict();
export type PlaceValueChange = z.infer<typeof placeValueChangeSchema>;
export const placeValueMotionSchema = z.object({ ...changeFields, id: z.string().uuid(), startedAt: z.number().int().min(0).max(10_000_000_000_000),
  durationMs: z.number().finite().min(1).max(60_000), progress: z.number().finite().min(0).max(1), paused: z.boolean() }).strict();
export type PlaceValueMotion = z.infer<typeof placeValueMotionSchema>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** 不同压缩分段仍表示同一批单位；最多比较一个颜色周期，不展开长串。 */
export function samePlaceValueGroup(a: PlaceValueGroup, b: PlaceValueGroup, base = PLACE_VALUE_COLOR_PERIOD) {
  if (groupSize(a) !== groupSize(b)) return false;
  let ai = 0, bi = 0, ao = 0, bo = 0;
  while (ai < a.length && bi < b.length) {
    const x = a[ai], y = b[bi], count = Math.min(x.count - ao, y.count - bo);
    if (x.start + ao !== y.start + bo) return false;
    for (let i = 0; i < Math.min(base, count); i++) if (((x.phase + ao + i) % base < Math.ceil(base / 2)) !== ((y.phase + bo + i) % base < Math.ceil(base / 2))) return false;
    ao += count; bo += count;
    if (ao === x.count) { ai++; ao = 0; }
    if (bo === y.count) { bi++; bo = 0; }
  }
  return true;
}
export function samePlaceValueBoard(a: PlaceValueBoard, b: PlaceValueBoard, period = PLACE_VALUE_COLOR_PERIOD) {
  return a.radix === b.radix && a.nextId === b.nextId && a.places.length === b.places.length
    && a.places.every((groups, level) => groups.length === b.places[level].length && groups.every((group, i) => samePlaceValueGroup(group, b.places[level][i], period)));
}
function validChangeWithPeriod(change: PlaceValueChange, period: number) {
  const { before, after, level, kind } = change;
  if (before.radix !== after.radix || before.places.length !== after.places.length || level >= before.places.length) return false;
  if (kind === "replace") return true;
  const copy = structuredClone(before), base = before.radix;
  if (kind === "add") {
    copy.places[0].push([{ start: copy.nextId++, count: 1, phase: copy.places[0].length % period }]);
  } else if (kind === "remove") {
    if (!copy.places[0].length) return false;
    copy.places[0].pop();
  } else if (kind === "carry") {
    if (level >= copy.places.length - 1 || copy.places[level].length < base) return false;
    const group = compactSpans(copy.places[level].splice(-base).flat(), period);
    const index = after.places[level + 1].findIndex((candidate) => samePlaceValueGroup(candidate, group, period));
    if (index < 0) return false;
    copy.places[level + 1].splice(index, 0, group);
  } else {
    if (level < 1) return false;
    const index = before.places[level].findIndex((group) => !after.places[level].some((other) => samePlaceValueGroup(group, other, period)));
    if (index < 0) return false;
    const group = copy.places[level].splice(index, 1)[0], weight = base ** (level - 1);
    copy.places[level - 1].push(...Array.from({ length: base }, (_, i) => sliceGroup(group, i * weight, weight, period)));
  }
  return samePlaceValueBoard(copy, after, period);
}
export function validPlaceValueChange(change: PlaceValueChange) {
  // 旧 v2 课堂命令按原颜色周期验证；新命令使用固定五黄五蓝，数量与成员检查相同。
  return validChangeWithPeriod(change, PLACE_VALUE_COLOR_PERIOD)
    || (change.before.radix !== PLACE_VALUE_COLOR_PERIOD && validChangeWithPeriod(change, change.before.radix));
}
export const placeValueSnapshotSchema = z.object({ ...fields, cameraRevision: z.number().int().min(0).max(1_000_000), motion: placeValueMotionSchema.nullable(),
  past: z.array(placeValueChangeSchema).max(PLACE_VALUE_HISTORY_LIMIT), future: z.array(placeValueChangeSchema).max(PLACE_VALUE_HISTORY_LIMIT) }).strict().superRefine((value, ctx) => {
  validateInitial(value, ctx);
  if (value.motion && !same(value[value.motion.side], value.motion.after)) ctx.addIssue({ code: "custom", message: "Motion must reach authoritative board" });
  for (const change of [...value.past, ...value.future, ...(value.motion ? [value.motion] : [])]) if (!validPlaceValueChange(change)
    || change.after.radix !== value.left.radix || change.after.places.length !== value.left.places.length) ctx.addIssue({ code: "custom", message: "Invalid regrouping history" });
});
export type PlaceValueSnapshot = z.infer<typeof placeValueSnapshotSchema>;
export const placeValueToolSchema = z.object({ toolId: z.literal("place-value"), contentVersion: z.literal(PLACE_VALUE_VERSION),
  payload: z.object({ title: z.string().trim().min(1).max(80), initial: placeValueInitialSchema }).strict() }).strict();
export function createDefaultPlaceValueInitial(): PlaceValueInitial {
  return { mode: "single", left: createPlaceValueBoard(9), right: createPlaceValueBoard(20), active: "left", selection: null,
    highlight: "all", comparison: "hidden", autoCarry: false, speed: "normal", showDigits: true, showLabels: true, grid: false, axes: false,
    view: "front", frame: { center: { x: 0, y: 4, z: 0 }, radius: 8.5 } };
}
export function placeValueSnapshot(initial: PlaceValueInitial): PlaceValueSnapshot {
  return { ...placeValueInitialSchema.parse(structuredClone(initial)), cameraRevision: 0, motion: null, past: [], future: [] };
}
export function placeValueInitial(snapshot: PlaceValueSnapshot): PlaceValueInitial {
  return placeValueInitialSchema.parse(Object.fromEntries(Object.keys(fields).map((key) => [key, snapshot[key as keyof typeof fields]])));
}

import { z } from "zod";
import { CUBE_COLORS, CUBE_MARK_SHAPES, CUBE_STRUCTURES_DRAFT_VERSION, CUBE_STRUCTURES_LIMITS, cubeDisplayCollides, validateCubeSequence,
  type CubeHistory, type CubeOperation, type CubeStructureState } from "./cube-structures-contract";
import type { CubeWorkbenchSession } from "./cube-structures-session";

export const CUBE_SAVED_DRAFT_VERSION = "cube-structures-saved-draft-v1" as const;
export const CUBE_SAVED_DRAFT_MAX_BYTES = 4_000_000;
export const CUBE_DRAFT_NAME_MAX = 80;
export type CubeDraftErrorCode = "invalid" | "version" | "too-large" | "unavailable" | "conflict" | "missing" | "auth-required" | "account-security" | "account-changed" | "limit";

export class CubeDraftError extends Error {
  constructor(readonly code: CubeDraftErrorCode) { super(`cube-draft:${code}`); }
}

const id = z.string().min(1).max(128);
const ids = z.array(id).max(CUBE_STRUCTURES_LIMITS.cubes).refine((values) => new Set(values).size === values.length);
const color = z.enum(CUBE_COLORS);
const axis = z.enum(["x", "y", "z"]);
const face = z.enum(["x+", "x-", "y+", "y-", "z+", "z-"]);
const view = z.enum(["angle", "front", "left", "right", "top"]);
const integer = z.number().int().min(-CUBE_STRUCTURES_LIMITS.coordinate).max(CUBE_STRUCTURES_LIMITS.coordinate);
const coordinate = z.object({ x: integer, y: integer, z: integer }).strict();
const offsetNumber = z.number().min(-CUBE_STRUCTURES_LIMITS.displayOffset).max(CUBE_STRUCTURES_LIMITS.displayOffset).multipleOf(0.5);
const offset = z.object({ x: offsetNumber, y: offsetNumber, z: offsetNumber }).strict();
const finitePoint = z.object({ x: z.number().min(-1000).max(1000), y: z.number().min(-1000).max(1000), z: z.number().min(-1000).max(1000) }).strict();
const frame = z.object({ center: finitePoint, radius: z.number().positive().max(1000) }).strict();
const label = { placement: z.enum(["side", "face", "center"]), direction: face, color };
const counter = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1);
const groupName = z.string().trim().min(1).max(40);
const opacity = z.number().min(0).max(1);

export const cubeStructureStateSchema = z.object({
  cubes: z.array(z.object({
    id, position: coordinate, color,
    faces: z.object({ "x+": color.optional(), "x-": color.optional(), "y+": color.optional(), "y-": color.optional(), "z+": color.optional(), "z-": color.optional() }).strict(),
    displayOffset: offset.optional(), opacity: opacity.optional(),
    mark: z.object({ ...label, shape: z.enum(CUBE_MARK_SHAPES) }).strict().optional(),
    numberLabel: z.object({ ...label, value: z.number().int().min(1).max(9999) }).strict().optional(),
  }).strict()).max(CUBE_STRUCTURES_LIMITS.cubes),
  hiddenCubeIds: ids,
  groups: z.array(z.object({ id, name: groupName, color, cubeIds: ids }).strict()).max(4096),
  origin: finitePoint.nullable(), axesVisible: z.boolean(), view, frame, nextCubeId: counter,
  nextNumber: z.number().int().min(1).max(10000), hiddenEdgesVisible: z.boolean(),
}).strict().superRefine((state, context) => {
  const cubeIds = new Set(state.cubes.map((cube) => cube.id));
  const positions = new Set(state.cubes.map((cube) => `${cube.position.x},${cube.position.y},${cube.position.z}`));
  const numbers = state.cubes.flatMap((cube) => cube.numberLabel ? [cube.numberLabel.value] : []);
  const invalid = cubeIds.size !== state.cubes.length || positions.size !== state.cubes.length
    || new Set(state.groups.map((group) => group.id)).size !== state.groups.length
    || state.hiddenCubeIds.some((value) => !cubeIds.has(value))
    || state.groups.some((group) => group.cubeIds.some((value) => !cubeIds.has(value)))
    || numbers.length !== new Set(numbers).size || numbers.some((value) => value >= state.nextNumber)
    || state.cubes.some((cube) => /^cube-\d+$/.test(cube.id) && Number(cube.id.slice(5)) >= state.nextCubeId)
    || (state.cubes.length > 0 && state.origin === null)
    || cubeDisplayCollides(state.cubes, state.cubes);
  if (invalid) context.addIssue({ code: "custom", message: "Invalid cube structure references or geometry" });
}) satisfies z.ZodType<CubeStructureState>;

const operationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("build"), id, groupId: id.optional(), position: coordinate, displayOffset: offset.optional(), color }).strict(),
  z.object({ kind: z.literal("remove"), ids }).strict(),
  z.object({ kind: z.literal("color"), ids, color }).strict(),
  z.object({ kind: z.literal("paint"), faces: z.array(z.object({ id, direction: face }).strict()).max(CUBE_STRUCTURES_LIMITS.cubes * 6), color }).strict(),
  z.object({ kind: z.literal("clear-paint"), ids }).strict(),
  z.object({ kind: z.literal("layer"), axis, index: integer, visible: z.boolean(), ids }).strict(),
  z.object({ kind: z.literal("show-all"), ids }).strict(),
  z.object({ kind: z.literal("group"), id, name: groupName, color, ids }).strict(),
  z.object({ kind: z.literal("ungroup"), id }).strict(),
  z.object({ kind: z.literal("move"), ids, axis, distance: z.number().int().min(-24).max(24).refine((value) => value !== 0) }).strict(),
  z.object({ kind: z.literal("cut"), ids, scopeIds: ids, axis, after: integer, side: z.union([z.literal(-1), z.literal(1)]),
    distance: z.number().min(0.5).max(8).multipleOf(0.5), groupId: id, name: groupName, color }).strict(),
  z.object({ kind: z.literal("display-move"), ids, axis, distance: z.number().min(-48).max(48).multipleOf(0.5).refine((value) => value !== 0) }).strict(),
  z.object({ kind: z.literal("display-reset"), ids }).strict(),
  z.object({ kind: z.literal("mark"), ids, shape: z.enum(CUBE_MARK_SHAPES), ...label }).strict(),
  z.object({ kind: z.literal("number"), id, value: z.number().int().min(1).max(9999), ...label }).strict(),
  z.object({ kind: z.literal("clear-labels"), ids, target: z.enum(["mark", "number"]) }).strict(),
  z.object({ kind: z.literal("restart-numbering") }).strict(),
  z.object({ kind: z.literal("opacity"), ids, opacity }).strict(),
  z.object({ kind: z.literal("hidden-edges"), visible: z.boolean() }).strict(),
  z.object({ kind: z.literal("axes"), visible: z.boolean() }).strict(),
  z.object({ kind: z.literal("view"), view, frame }).strict(),
]) satisfies z.ZodType<CubeOperation>;

export const cubeHistorySchema = z.object({
  version: z.literal(CUBE_STRUCTURES_DRAFT_VERSION), initial: cubeStructureStateSchema,
  operations: z.array(operationSchema).max(CUBE_STRUCTURES_LIMITS.steps), cursor: z.number().int().min(0),
}).strict().superRefine((history, context) => {
  if (history.cursor > history.operations.length || validateCubeSequence(history.initial, history.operations)) {
    context.addIssue({ code: "custom", message: "Invalid operation sequence" });
  }
}) satisfies z.ZodType<CubeHistory>;

export interface CubeDraftSnapshot {
  readonly version: typeof CUBE_SAVED_DRAFT_VERSION;
  readonly session: CubeWorkbenchSession;
  readonly identity: number;
}

const snapshotSchema = z.object({
  version: z.literal(CUBE_SAVED_DRAFT_VERSION),
  session: z.object({ work: cubeHistorySchema, lesson: cubeHistorySchema.nullable(), recording: z.enum(["off", "paused"]), preview: z.null() }).strict()
    .refine((session) => session.recording === "off" || session.lesson !== null),
  identity: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
}).strict() satisfies z.ZodType<CubeDraftSnapshot>;

/** 只保存备课语义状态；临场副本、指针预览、回看位置和自动播放不进入持久草稿。 */
export function cubeDraftSnapshot(prepared: CubeWorkbenchSession, identity: number): CubeDraftSnapshot {
  return { version: CUBE_SAVED_DRAFT_VERSION, session: { ...prepared, recording: prepared.recording === "recording" ? "paused" : prepared.recording, preview: null },
    identity: Math.max(identity, cubeDraftIdentity(prepared)) };
}

/** 打开旧现场后继续递增，包含撤销后的未来步骤和已移除对象，避免复用稳定 ID。 */
export function cubeDraftIdentity(session: CubeWorkbenchSession): number {
  let maximum = 0;
  const inspect = (value: string) => {
    const match = /^(?:added|group|cut)-(\d+)$/.exec(value);
    if (match) maximum = Math.max(maximum, Number(match[1]));
  };
  for (const history of [session.work, session.lesson]) {
    if (!history) continue;
    history.initial.cubes.forEach((cube) => inspect(cube.id));
    history.initial.groups.forEach((group) => inspect(group.id));
    for (const operation of history.operations) {
      if ("id" in operation && operation.id) inspect(operation.id);
      if ("groupId" in operation && operation.groupId) inspect(operation.groupId);
      if ("ids" in operation) operation.ids?.forEach(inspect);
      if (operation.kind === "cut") operation.scopeIds.forEach(inspect);
      if (operation.kind === "paint") operation.faces.forEach((item) => inspect(item.id));
    }
  }
  return maximum;
}

export function parseCubeDraftSnapshot(input: unknown): CubeDraftSnapshot {
  let value: unknown;
  try {
    const serialized = typeof input === "string" ? input : JSON.stringify(input);
    if (!serialized) throw new CubeDraftError("invalid");
    if (serialized.length > CUBE_SAVED_DRAFT_MAX_BYTES || new TextEncoder().encode(serialized).byteLength > CUBE_SAVED_DRAFT_MAX_BYTES) throw new CubeDraftError("too-large");
    value = JSON.parse(serialized);
  } catch (error) { throw error instanceof CubeDraftError ? error : new CubeDraftError("invalid"); }
  if (value && typeof value === "object" && "version" in value && value.version !== CUBE_SAVED_DRAFT_VERSION) throw new CubeDraftError("version");
  const result = snapshotSchema.safeParse(value);
  if (!result.success) throw new CubeDraftError("invalid");
  const identity = Math.max(result.data.identity, cubeDraftIdentity(result.data.session));
  if (!Number.isSafeInteger(identity) || identity >= Number.MAX_SAFE_INTEGER) throw new CubeDraftError("invalid");
  return { ...result.data, identity };
}

/** 用于未保存提示；临时回放与录制中／暂停的切换不改变待保存的备课内容。 */
export function cubeDraftContentKey(prepared: CubeWorkbenchSession): string {
  return JSON.stringify(cubeDraftSnapshot(prepared, 0).session);
}

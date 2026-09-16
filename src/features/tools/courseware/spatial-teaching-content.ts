import { z } from "zod";
import { CUBE_COLORS, CUBE_MARK_SHAPES } from "../spatial-lab/cube-structures-contract";
import { CUBE_NET_COURSEWARE_VERSION, DICE_COURSEWARE_VERSION } from "./registry";

/** 课件只保存教学起点；个人草稿、撤销栈、鼠标预览和动画中间帧不进入固定副本。 */
export const SPATIAL_TEACHING_CONTENT_MAX_BYTES = 96_000;
const coordinate = z.number().finite().min(-1000).max(1000);
const vector = z.object({ x: coordinate, y: coordinate, z: coordinate }).strict();
const frame = z.object({ center: vector, radius: z.number().positive().max(2000) }).strict();
const view = z.enum(["angle", "front", "left", "right", "top"]);
const color = z.enum(CUBE_COLORS);
const diceFace = z.enum(["x+", "x-", "y+", "y-", "z+", "z-"]);
const unique = <T,>(items: readonly T[]) => new Set(items).size === items.length;
const rotation = z.object({ x: z.number().min(-1).max(1), y: z.number().min(-1).max(1), z: z.number().min(-1).max(1), w: z.number().min(-1).max(1) }).strict()
  .refine((q) => Math.abs(q.x ** 2 + q.y ** 2 + q.z ** 2 + q.w ** 2 - 1) < 0.0001, "Unit quaternion required");
const die = z.object({
  id: z.string().regex(/^dice-[1-9][0-9]{0,8}$/), hand: z.enum(["right", "left"]), position: vector, rotation,
  hidden: z.array(diceFace).max(6).refine(unique),
  offsets: z.partialRecord(diceFace, z.number().min(0).max(0.9)),
  surfaces: z.partialRecord(diceFace, z.object({ color: color.optional(), opacity: z.number().min(0).max(1).optional() }).strict()).optional(),
}).strict();
export const diceSceneSchema = z.object({
  version: z.literal("dice-teaching-v1"), dice: z.array(die).min(1).max(8),
  trail: z.array(z.object({ x: coordinate, z: coordinate, value: z.number().int().min(1).max(6), points: z.array(vector).min(1).max(6) }).strict()
    .refine((footprint) => footprint.points.length === footprint.value)).max(128),
  nextId: z.number().int().positive().max(999_999_999),
  puzzle: z.object({ scope: z.enum(["each", "total"]), target: z.number().int().min(2).max(144), revealed: z.boolean() }).strict().nullable(),
}).strict().refine((scene) => unique(scene.dice.map((item) => item.id)) && scene.dice.every((item) => Number(item.id.slice(5)) < scene.nextId), "Unique dice identities required");
export const diceTeachingSnapshotSchema = z.object({
  scene: diceSceneSchema, view: z.enum([...view.options, "bottom"]), frame,
  axes: z.boolean(), grid: z.boolean(), floor: z.boolean(), arrows: z.boolean(), selectedId: die.shape.id,
}).strict().refine((snapshot) => snapshot.scene.dice.some((item) => item.id === snapshot.selectedId), "Selected die must exist");
export type DiceTeachingSnapshot = z.infer<typeof diceTeachingSnapshotSchema>;

export const NET_FACE_IDS = ["face.x.neg", "face.x.pos", "face.y.neg", "face.y.pos", "face.z.neg", "face.z.pos"] as const;
const faceId = z.enum(NET_FACE_IDS);
const vertices = Array.from({ length: 8 }, (_, index) => `v${index.toString(2).padStart(3, "0")}`);
export const NET_EDGE_IDS = vertices.flatMap((a, i) => vertices.slice(i + 1).filter((b) => [...a].filter((value, index) => value !== b[index]).length === 1).map((b) => `edge.${a}-${b}`));
const edgeId = z.string().refine((id) => NET_EDGE_IDS.includes(id));
const identity = z.enum(["A", "B", "C", "D", "E", "F"]);
const surfaces = z.object({
  faces: z.partialRecord(identity, z.object({ color, opacity: z.number().min(0).max(1),
    mark: z.object({ kind: z.enum(["letter", ...CUBE_MARK_SHAPES]), color }).strict().nullable(),
    number: z.object({ value: z.number().int().min(1).max(9999), color }).strict().nullable(),
  }).strict()), nextNumber: z.number().int().min(1).max(10000),
}).strict();
const anchor = z.object({ faceId, vertices: z.tuple([vector, vector, vector]) }).strict().refine(({ vertices: [a, b, c] }) => {
  const squared = (p: typeof a, q: typeof a) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2;
  return Math.abs(squared(a, b) - 1) < 0.0001 && Math.abs(squared(b, c) - 1) < 0.0001 && Math.abs(squared(a, c) - 2) < 0.0001;
}, "Unit square anchor required").nullable();
const rigidMatrix = z.array(z.number().finite().min(-2000).max(2000)).length(16).refine((m) => {
  const dot = (a: number, b: number) => m[a] * m[b] + m[a + 1] * m[b + 1] + m[a + 2] * m[b + 2];
  const determinant = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
  return [0, 4, 8].every((a) => Math.abs(dot(a, a) - 1) < 0.0001)
    && [[0, 4], [0, 8], [4, 8]].every(([a, b]) => Math.abs(dot(a, b)) < 0.0001)
    && Math.abs(determinant - 1) < 0.0001 && [m[3], m[7], m[11], m[15] - 1].every((n) => Math.abs(n) < 0.0001);
}, "Rigid face pose required");
// v1 固定副本的目录身份与折痕元数据。合同测试逐项对照真实构建器，避免校验入口加载 3D 内核。
const NET_V1_HINGES: Readonly<Record<string, readonly string[]>> = Object.fromEntries([
  ["19", "000-001 010-110 011-111 100-101 110-111"],
  ["20", "000-001 010-110 011-111 100-101 100-110"],
  ["26", "000-010 011-111 100-101 100-110 110-111"],
  ["27", "000-010 000-100 011-111 100-110 110-111"],
  ["28", "000-001 000-010 011-111 100-110 110-111"],
  ["30", "000-001 011-111 100-101 100-110 110-111"],
  ["31", "000-001 000-100 011-111 100-110 110-111"],
  ["32", "000-001 000-100 011-111 100-101 110-111"],
  ["33", "000-001 000-010 011-111 100-101 110-111"],
  ["34", "010-011 100-101 100-110 101-111 110-111"],
  ["35", "010-011 010-110 100-101 101-111 110-111"],
].map(([id, hinges]) => [`cube-net-gallery.${id}`, hinges.split(" ").map((edge) => `edge.v${edge.replace("-", "-v")}`)]));
const entryId = z.string().refine((id) => Object.hasOwn(NET_V1_HINGES, id));
function connectedCubeFaces(hinges: readonly string[]) {
  const adjacent = hinges.map((id) => {
    const [a, b] = id.slice(6).split("-v");
    return ["x", "y", "z"].flatMap((axis, index) => a[index] === b[index] ? [`face.${axis}.${a[index] === "0" ? "neg" : "pos"}`] : []);
  });
  const visited = new Set<string>([NET_FACE_IDS[0]]);
  for (let pass = 0; pass < 5; pass++) for (const pair of adjacent) {
    if (pair.some((id) => visited.has(id))) pair.forEach((id) => visited.add(id));
  }
  return visited.size === 6;
}
export const cubeNetTeachingSnapshotSchema = z.object({
  source: z.object({ entryId, cuts: z.array(edgeId).length(7).refine(unique).nullable() }).strict(),
  angles: z.record(edgeId, z.number().int().min(-90).max(90)).refine((angles) => Object.keys(angles).length === 5),
  anchor, surfaces,
  labels: z.partialRecord(faceId, identity).refine((labels) => Object.keys(labels).length === 0 || Object.keys(labels).length === 6 && unique(Object.values(labels))),
  cutting: z.object({ cuts: z.array(edgeId).max(12).refine(unique), poses: z.partialRecord(faceId, rigidMatrix), surfaces }).strict().nullable(),
  faceOffsets: z.partialRecord(faceId, z.number().min(0).max(1)), revealEnabled: z.boolean(),
  view, axesVisible: z.boolean(), frame: frame.extend({ min: vector, max: vector }).strict(),
}).strict().refine((snapshot) => snapshot.cutting !== null || !snapshot.revealEnabled && Object.keys(snapshot.faceOffsets).length === 0, "Face reveal requires cutting mode")
  .refine((snapshot) => {
    const expected = snapshot.source.cuts ? NET_EDGE_IDS.filter((id) => !snapshot.source.cuts!.includes(id)) : NET_V1_HINGES[snapshot.source.entryId];
    return !!expected && connectedCubeFaces(expected) && expected.every((id) => Object.hasOwn(snapshot.angles, id));
  }, "Hinges must match the saved net source");
export type CubeNetTeachingSnapshot = z.infer<typeof cubeNetTeachingSnapshotSchema>;

function withinBudget(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= SPATIAL_TEACHING_CONTENT_MAX_BYTES; }
const title = z.string().trim().min(1).max(80);
export const diceCoursewareToolSchema = z.object({
  toolId: z.literal("spatial-lab"), contentVersion: z.literal(DICE_COURSEWARE_VERSION),
  payload: z.object({ title, initial: diceTeachingSnapshotSchema }).strict(),
}).strict().refine(withinBudget, "Spatial courseware content exceeds its budget");
export const cubeNetCoursewareToolSchema = z.object({
  toolId: z.literal("spatial-lab"), contentVersion: z.literal(CUBE_NET_COURSEWARE_VERSION),
  payload: z.object({ title, initial: cubeNetTeachingSnapshotSchema }).strict(),
}).strict().refine(withinBudget, "Spatial courseware content exceeds its budget");
export const spatialTeachingToolSchema = z.discriminatedUnion("contentVersion", [cubeNetCoursewareToolSchema, diceCoursewareToolSchema]);
export type SpatialTeachingTool = z.infer<typeof spatialTeachingToolSchema>;
export function isSpatialTeachingTool(tool: { contentVersion: string }): tool is SpatialTeachingTool {
  return tool.contentVersion === CUBE_NET_COURSEWARE_VERSION || tool.contentVersion === DICE_COURSEWARE_VERSION;
}

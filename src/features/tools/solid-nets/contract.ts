import { z } from "zod";
import { CUBE_COLORS } from "../spatial-lab/cube-structures-contract";
import { solidNetGeometry, type SolidNetDimensions, type SolidNetKind, type LegacySolidNetKind } from "./geometry";

export const SOLID_NETS_VERSION = "solid-nets-v1" as const;
export const SOLID_NETS_SNAPSHOT_VERSION = "solid-nets-v2" as const;
export const SOLID_NETS_LESSON_VERSION = "solid-nets-lesson-v1" as const;
export const SOLID_NET_KINDS = ["cube", "cuboid", "triangular-prism"] as const;
export const SOLID_NETS_POLYHEDRA_VERSION = "solid-nets-v3" as const;
export const SOLID_NETS_POLYHEDRA_LESSON_VERSION = "solid-nets-lesson-v2" as const;
export const SOLID_NET_POLYHEDRA_KINDS = [...SOLID_NET_KINDS, "square-pyramid"] as const;
export const SOLID_NETS_LIMITS = { minDimension: 0.25, maxDimension: 8, history: 30 } as const;
const dimension = z.number().finite().min(SOLID_NETS_LIMITS.minDimension).max(SOLID_NETS_LIMITS.maxDimension);
const point = z.object({ x: z.number().finite().min(-100).max(100), y: z.number().finite().min(-100).max(100), z: z.number().finite().min(-100).max(100) }).strict();
const surface = z.object({ color: z.enum(CUBE_COLORS), label: z.string().max(8), opacity: z.number().finite().min(0).max(1) }).strict();
const snapshot = z.object({
  version: z.literal(SOLID_NETS_VERSION),
  kind: z.enum(["cuboid", "triangular-prism"]),
  dimensions: z.object({ width: dimension, height: dimension, depth: dimension }).strict(),
  angles: z.record(z.string().max(30), z.number().finite().min(-180).max(180)),
  surfaces: z.record(z.string().max(15), surface),
  anchor: z.object({ faceId: z.string().max(15), vertices: z.tuple([point, point, point]) }).strict().nullable(),
  view: z.enum(["angle", "front", "left", "right", "top"]),
  labelsVisible: z.boolean(),
}).strict();

const teachingSnapshot = snapshot.extend({ version: z.literal(SOLID_NETS_SNAPSHOT_VERSION), kind: z.enum(SOLID_NET_KINDS) });
const polyhedraSnapshot = snapshot.extend({ version: z.literal(SOLID_NETS_POLYHEDRA_VERSION), kind: z.enum(SOLID_NET_POLYHEDRA_KINDS) });
function validateSnapshot(value: z.infer<typeof snapshot> | z.infer<typeof teachingSnapshot> | z.infer<typeof polyhedraSnapshot>, ctx: z.RefinementCtx) {
  if (value.kind === "cube" && (value.dimensions.width !== value.dimensions.height || value.dimensions.width !== value.dimensions.depth)) {
    ctx.addIssue({ code: "custom", message: "SOLID_NET_CUBE_DIMENSIONS" });
  }
  if (value.kind === "square-pyramid" && value.dimensions.width !== value.dimensions.depth) {
    ctx.addIssue({ code: "custom", message: "SOLID_NET_SQUARE_BASE" });
  }
  const geometry = solidNetGeometry(value.kind, value.dimensions), add = (message: string) => ctx.addIssue({ code: "custom", message });
  const faces = new Set(geometry.faces.map((face) => face.id));
  if (Object.keys(value.surfaces).length !== faces.size || Object.keys(value.surfaces).some((id) => !faces.has(id))) add("SOLID_NET_SURFACES");
  const hinges = new Map(geometry.hinges.map((hinge) => [hinge.id, hinge]));
  if (Object.keys(value.angles).length !== hinges.size || Object.keys(value.angles).some((id) => !hinges.has(id))) add("SOLID_NET_ANGLES");
  for (const [id, angle] of Object.entries(value.angles)) if (Math.abs(angle) > (hinges.get(id)?.closedDegrees ?? 0) + 1e-7) add("SOLID_NET_ANGLE_RANGE");
  if (value.anchor) {
    const face = geometry.faces.find((entry) => entry.id === value.anchor!.faceId);
    if (!face) { add("SOLID_NET_ANCHOR_FACE"); return; }
    const squared = (a: z.infer<typeof point>, b: z.infer<typeof point>) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
    for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
      const expected = squared(face.vertices[a], face.vertices[b]);
      if (Math.abs(squared(value.anchor.vertices[a], value.anchor.vertices[b]) - expected) > Math.max(1, expected) * 1e-6) add("SOLID_NET_ANCHOR_GEOMETRY");
    }
  }
}
export const solidNetsSnapshotSchema = snapshot.superRefine(validateSnapshot);
export const solidNetsTeachingSnapshotSchema = teachingSnapshot.superRefine(validateSnapshot);
export const solidNetsPolyhedraSnapshotSchema = polyhedraSnapshot.superRefine(validateSnapshot);
export const preparedSolidNetsSnapshotSchema = z.discriminatedUnion("version", [solidNetsTeachingSnapshotSchema, solidNetsPolyhedraSnapshotSchema]);
export const anySolidNetsSnapshotSchema = z.discriminatedUnion("version", [solidNetsSnapshotSchema, solidNetsTeachingSnapshotSchema, solidNetsPolyhedraSnapshotSchema]);
export type SolidNetsSnapshot = z.infer<typeof solidNetsSnapshotSchema>;
export type SolidNetsTeachingSnapshot = z.infer<typeof solidNetsTeachingSnapshotSchema>;
export type SolidNetsPolyhedraSnapshot = z.infer<typeof solidNetsPolyhedraSnapshotSchema>;
export type PreparedSolidNetsSnapshot = z.infer<typeof preparedSolidNetsSnapshotSchema>;
export type AnySolidNetsSnapshot = z.infer<typeof anySolidNetsSnapshotSchema>;
export const solidNetsContentSchema = z.object({ title: z.string().trim().min(1).max(80), initial: solidNetsSnapshotSchema }).strict();
export const solidNetsToolSchema = z.object({
  toolId: z.literal("solid-nets"), contentVersion: z.literal(SOLID_NETS_LESSON_VERSION),
  payload: solidNetsContentSchema.extend({ initial: solidNetsTeachingSnapshotSchema }),
}).strict();
export const solidNetsPolyhedraToolSchema = solidNetsToolSchema.extend({
  contentVersion: z.literal(SOLID_NETS_POLYHEDRA_LESSON_VERSION),
  payload: solidNetsContentSchema.extend({ initial: solidNetsPolyhedraSnapshotSchema }),
});

function initialSolidNet(kind: SolidNetKind, dimensions: SolidNetDimensions) {
  const geometry = solidNetGeometry(kind, dimensions);
  return { kind, dimensions: { ...dimensions },
    angles: Object.fromEntries(geometry.hinges.map((hinge) => [hinge.id, 0])),
    surfaces: Object.fromEntries(geometry.faces.map((face, index) => [face.id, { color: CUBE_COLORS[index], label: String.fromCharCode(65 + index), opacity: 0.9 }])),
    anchor: null, view: "angle" as const, labelsVisible: true };
}

export function createDefaultSolidNetsSnapshot(kind: LegacySolidNetKind = "cuboid", dimensions: SolidNetDimensions = { width: 3, height: 2, depth: 2.5 }): SolidNetsSnapshot {
  return solidNetsSnapshotSchema.parse({ ...initialSolidNet(kind, dimensions), version: SOLID_NETS_VERSION });
}

export function createDefaultSolidNetsTeachingSnapshot(kind: typeof SOLID_NET_KINDS[number] = "cube", dimensions?: SolidNetDimensions): SolidNetsTeachingSnapshot {
  return solidNetsTeachingSnapshotSchema.parse({
    ...initialSolidNet(kind, dimensions ?? (kind === "cube" ? { width: 2, height: 2, depth: 2 } : { width: 3, height: 2, depth: 2.5 })),
    version: SOLID_NETS_SNAPSHOT_VERSION,
  });
}

export function createDefaultSolidNetsPolyhedraSnapshot(kind: SolidNetKind = "cube", dimensions?: SolidNetDimensions): SolidNetsPolyhedraSnapshot {
  return solidNetsPolyhedraSnapshotSchema.parse({
    ...initialSolidNet(kind, dimensions ?? (kind === "cube" ? { width: 2, height: 2, depth: 2 }
      : kind === "square-pyramid" ? { width: 3, height: 2, depth: 3 } : { width: 3, height: 2, depth: 2.5 })),
    version: SOLID_NETS_POLYHEDRA_VERSION,
  });
}

/** 各冻结版本保留自己的形体边界，尺寸修改和形体切换使用同一个入口。 */
export function createSolidNetForVersion(version: AnySolidNetsSnapshot["version"], kind: SolidNetKind, dimensions?: SolidNetDimensions): AnySolidNetsSnapshot {
  if (version === SOLID_NETS_POLYHEDRA_VERSION) return createDefaultSolidNetsPolyhedraSnapshot(kind, dimensions);
  if (kind === "square-pyramid" || (version === SOLID_NETS_VERSION && kind === "cube")) throw new Error("SOLID_NET_VERSION_KIND");
  return version === SOLID_NETS_VERSION && kind !== "cube" ? createDefaultSolidNetsSnapshot(kind, dimensions) : createDefaultSolidNetsTeachingSnapshot(kind, dimensions);
}

export function solidNetKindsForVersion(version: AnySolidNetsSnapshot["version"]) {
  return version === SOLID_NETS_VERSION ? ["cuboid", "triangular-prism"] as const
    : version === SOLID_NETS_SNAPSHOT_VERSION ? SOLID_NET_KINDS : SOLID_NET_POLYHEDRA_KINDS;
}

export function resizeSolidNet(value: AnySolidNetsSnapshot, dimensions: SolidNetDimensions): AnySolidNetsSnapshot {
  const next = createSolidNetForVersion(value.version, value.kind, dimensions);
  return anySolidNetsSnapshotSchema.parse({ ...next, surfaces: value.surfaces, labelsVisible: value.labelsVisible, view: value.view });
}

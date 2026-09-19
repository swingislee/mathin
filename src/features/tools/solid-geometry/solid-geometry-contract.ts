import { z } from "zod";
import { CUBE_COLORS } from "../spatial-lab/cube-structures-contract";
import { validSolidFeature } from "./solid-geometry";
import { createSolidSectionSettings, solidSectionSettingsSchema } from "../solid-sections/solid-sections-contract";
import { createMeasurementSettings, measurementSettingsSchema } from "../solid-measurement/measurement-contract";

export const SOLID_GEOMETRY_VERSION = "solid-geometry-lesson-v1" as const;
export const SOLID_KINDS = ["cube", "cuboid", "triangular-prism", "square-pyramid", "cylinder", "cone", "sphere"] as const;
export type SolidKind = (typeof SOLID_KINDS)[number];
export const SOLID_LIMITS = { entities: 16, dimensionMin: 0.2, dimensionMax: 12, coordinate: 30 } as const;
export interface SolidVector { x: number; y: number; z: number }
export const solidVectorSchema = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }).strict();
const dimension = z.number().finite().min(SOLID_LIMITS.dimensionMin).max(SOLID_LIMITS.dimensionMax);
export const solidDimensionsSchema = z.object({ width: dimension, height: dimension, depth: dimension, radius: dimension }).strict();
export type SolidDimensions = z.infer<typeof solidDimensionsSchema>;
/** Y 竖直，实体中心为局部原点；rotation 为 XYZ 欧拉弧度。曲面使用真实半径，不使用单位方块近似。 */
export const solidEntitySchema = z.object({
  id: z.string().min(1).max(80), kind: z.enum(SOLID_KINDS), dimensions: solidDimensionsSchema,
  position: solidVectorSchema.refine((v) => Object.values(v).every((n) => Math.abs(n) <= SOLID_LIMITS.coordinate)),
  rotation: solidVectorSchema.refine((v) => Object.values(v).every((n) => Math.abs(n) <= Math.PI * 2)),
  color: z.enum(CUBE_COLORS), opacity: z.number().finite().min(0).max(1),
}).strict().superRefine((entity, ctx) => {
  const d = entity.dimensions;
  if (entity.kind === "cube" && (d.width !== d.height || d.width !== d.depth)) ctx.addIssue({ code: "custom", message: "A cube has equal sides", path: ["dimensions"] });
  if (entity.kind === "square-pyramid" && d.width !== d.depth) ctx.addIssue({ code: "custom", message: "A square pyramid has a square base", path: ["dimensions", "depth"] });
});
export type SolidEntity = z.infer<typeof solidEntitySchema>;
export const solidFeatureSchema = z.object({ entityId: z.string().min(1).max(80), kind: z.enum(["face", "edge", "vertex"]), id: z.string().min(1).max(40) }).strict();
export type SolidFeatureSelection = z.infer<typeof solidFeatureSchema>;
const stateFields = {
  entities: z.array(solidEntitySchema).max(SOLID_LIMITS.entities),
  selectedId: z.string().min(1).max(80).nullable(), feature: solidFeatureSchema.nullable(),
  axes: z.boolean(), grid: z.boolean(), view: z.enum(["angle", "front", "left", "right", "top", "bottom"]),
  section: solidSectionSettingsSchema.default(createSolidSectionSettings),
  measurement: measurementSettingsSchema.default(createMeasurementSettings),
};
function validReferences(state: { entities: SolidEntity[]; selectedId: string | null; feature: SolidFeatureSelection | null }, ctx: z.RefinementCtx) {
  const ids = new Set(state.entities.map((entity) => entity.id));
  if (ids.size !== state.entities.length) ctx.addIssue({ code: "custom", message: "Duplicate entity id", path: ["entities"] });
  if (state.selectedId !== null && !ids.has(state.selectedId)) ctx.addIssue({ code: "custom", message: "Missing selected entity", path: ["selectedId"] });
  if (state.feature && (state.feature.entityId !== state.selectedId || !ids.has(state.feature.entityId))) ctx.addIssue({ code: "custom", message: "Missing feature entity", path: ["feature"] });
  if (state.feature) { const entity = state.entities.find((item) => item.id === state.feature!.entityId);
    if (entity && !validSolidFeature(entity, state.feature)) ctx.addIssue({ code: "custom", message: "Feature does not exist on this solid", path: ["feature"] }); }
}
export const solidGeometryInitialSchema = z.object(stateFields).strict().superRefine(validReferences);
export type SolidGeometryInitial = z.infer<typeof solidGeometryInitialSchema>;
export const solidGeometrySnapshotSchema = z.object({ ...stateFields, cameraRevision: z.number().int().min(0).max(1_000_000) }).strict().superRefine(validReferences);
export type SolidGeometrySnapshot = z.infer<typeof solidGeometrySnapshotSchema>;
export const solidGeometryToolSchema = z.object({ toolId: z.literal("solid-geometry"), contentVersion: z.literal(SOLID_GEOMETRY_VERSION),
  payload: z.object({ title: z.string().trim().min(1).max(80), initial: solidGeometryInitialSchema }).strict(),
}).strict();
export type SolidGeometryToolScene = z.infer<typeof solidGeometryToolSchema>;

export function createSolidEntity(kind: SolidKind, id: string, position: SolidVector = { x: 0, y: 1, z: 0 }): SolidEntity {
  return { id, kind, dimensions: { width: kind === "cuboid" ? 3 : 2, height: 2, depth: kind === "cuboid" ? 1.5 : kind === "triangular-prism" ? 3 : 2, radius: 1 }, position: { ...position },
    rotation: { x: 0, y: 0, z: 0 }, color: CUBE_COLORS[0], opacity: 1 };
}
export function createSolidGeometryInitial(): SolidGeometryInitial {
  return { entities: [createSolidEntity("cuboid", "solid-origin")], selectedId: "solid-origin", feature: null, axes: true, grid: false, view: "angle", section: createSolidSectionSettings(), measurement: createMeasurementSettings() };
}
export function solidGeometrySnapshot(initial: SolidGeometryInitial): SolidGeometrySnapshot {
  return { ...solidGeometryInitialSchema.parse(structuredClone(initial)), cameraRevision: 0 };
}
export function solidGeometryInitial(snapshot: SolidGeometrySnapshot): SolidGeometryInitial {
  return solidGeometryInitialSchema.parse({ entities: snapshot.entities, selectedId: snapshot.selectedId, feature: snapshot.feature, axes: snapshot.axes, grid: snapshot.grid, view: snapshot.view, section: snapshot.section, measurement: snapshot.measurement });
}
/** 本字段实际适用的参数；隐藏字段不会作为另一种实体的尺寸使用。 */
export function solidDimensionKeys(kind: SolidKind): (keyof SolidDimensions)[] {
  if (kind === "cube") return ["width"];
  if (kind === "square-pyramid") return ["width", "height"];
  if (kind === "sphere") return ["radius"];
  if (kind === "cylinder" || kind === "cone") return ["radius", "height"];
  return ["width", "height", "depth"];
}
export function resizeSolidEntity(entity: SolidEntity, key: keyof SolidDimensions, value: number): SolidEntity {
  if (!solidDimensionKeys(entity.kind).includes(key)) return entity;
  const dimensions = { ...entity.dimensions, [key]: value };
  if (entity.kind === "cube") dimensions.width = dimensions.height = dimensions.depth = value;
  if (entity.kind === "square-pyramid" && key === "width") dimensions.depth = value;
  const next = { ...entity, dimensions };
  return solidEntitySchema.parse(next);
}

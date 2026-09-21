import { z } from "zod";
import { newId } from "@/lib/uuid";
import { CUBE_COLORS } from "../spatial-lab/cube-structures-contract";
import { createSolidGeometryInitial, solidGeometryInitialSchema, solidGeometrySnapshotSchema, solidVectorSchema, type SolidEntity, type SolidGeometryInitial } from "./solid-geometry-contract";
import { getSolidTopology, type SolidMeshData } from "./solid-geometry";
import { createMeasurementV2Settings, measurementV2SettingsSchema, upgradeMeasurementSettings } from "../solid-measurement/measurement-v2-contract";
import { assembledCutPiecePosition, separatedCutPiecePosition, splitSolidByPlane, type SolidCutPlane } from "../solid-sections/solid-cut-model";
import { solidSectionSettingsSchema } from "../solid-sections/solid-sections-contract";

export const SOLID_GEOMETRY_EXPLORATION_VERSION = "solid-geometry-lesson-v2" as const;
const boundedPosition = solidVectorSchema.refine((v) => Object.values(v).every((n) => Math.abs(n) <= 30));
const boundedRotation = solidVectorSchema.refine((v) => Object.values(v).every((n) => Math.abs(n) <= Math.PI * 2));
const cutPieceSchema = z.object({ position: boundedPosition, rotation: boundedRotation, color: z.enum(CUBE_COLORS), opacity: z.number().finite().min(0).max(1) }).strict();
export const solidCutSchema = z.object({ id: z.string().min(1).max(40), entityId: z.string().min(1).max(80),
  normal: solidVectorSchema.refine((v) => Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-6), distance: z.number().finite().min(-24).max(24),
  pieces: z.tuple([cutPieceSchema, cutPieceSchema]), cutColor: z.enum(CUBE_COLORS),
}).strict();
export type SolidCut = z.infer<typeof solidCutSchema>;
export const solidCutPieceId = (cut: Pick<SolidCut, "id">, index: number) => `${cut.id}:${index === 0 ? "positive" : "negative"}`;
const fields = { ...solidGeometryInitialSchema.shape, section: solidSectionSettingsSchema, measurement: measurementV2SettingsSchema, cuts: z.array(solidCutSchema).max(16) };
type References = { entities: SolidEntity[]; selectedId: string | null; feature: { entityId: string; kind: "face" | "edge" | "vertex"; id: string } | null; cuts: SolidCut[] };
function validExploration(state: References, ctx: z.RefinementCtx) {
  const ids = new Set<string>(), cutSources = new Set<string>(), cutIds = new Set<string>();
  for (const entity of state.entities) { if (ids.has(entity.id)) ctx.addIssue({ code: "custom", message: "Duplicate entity" }); ids.add(entity.id); }
  const visible = new Map(state.entities.map((e) => [e.id, getSolidTopology(e)]));
  for (const cut of state.cuts) {
    const source = state.entities.find((e) => e.id === cut.entityId);
    if (!source || cutSources.has(cut.entityId) || cutIds.has(cut.id)) { ctx.addIssue({ code: "custom", path: ["cuts"], message: "Cut source must exist exactly once" }); continue; }
    cutSources.add(cut.entityId); cutIds.add(cut.id);
    const parts = splitSolidByPlane(source, cut);
    if (!parts) { ctx.addIssue({ code: "custom", path: ["cuts"], message: "The plane must cut through a supported solid" }); continue; }
    visible.delete(source.id);
    parts.forEach((part, index) => { const id = solidCutPieceId(cut, index); if (ids.has(id)) ctx.addIssue({ code: "custom", path: ["cuts"], message: "Duplicate piece id" }); ids.add(id); visible.set(id, solidMeshTopology(part.mesh)); });
  }
  if (state.selectedId && !visible.has(state.selectedId)) ctx.addIssue({ code: "custom", path: ["selectedId"], message: "Select a visible solid or cut piece" });
  if (state.feature) {
    const f = state.feature, topology = visible.get(f.entityId);
    const features = f.kind === "face" ? topology?.faces : f.kind === "edge" ? topology?.edges : topology?.vertices;
    if (state.selectedId !== f.entityId || !features?.some((item) => item.id === f.id)) ctx.addIssue({ code: "custom", path: ["feature"], message: "Feature must belong to selected object" });
  }
}
export const solidGeometryExplorationInitialSchema = z.object(fields).strict().superRefine(validExploration);
export const solidGeometryExplorationSnapshotSchema = z.object({ ...fields, cameraRevision: solidGeometrySnapshotSchema.shape.cameraRevision }).strict().superRefine(validExploration);
export type SolidGeometryExplorationInitial = z.infer<typeof solidGeometryExplorationInitialSchema>;
export type SolidGeometryExplorationSnapshot = z.infer<typeof solidGeometryExplorationSnapshotSchema>;
export const solidGeometryExplorationToolSchema = z.object({ toolId: z.literal("solid-geometry"), contentVersion: z.literal(SOLID_GEOMETRY_EXPLORATION_VERSION), payload: z.object({ title: z.string().trim().min(1).max(80), initial: solidGeometryExplorationInitialSchema }).strict() }).strict();
export function createSolidGeometryExplorationInitial(): SolidGeometryExplorationInitial {
  const base = createSolidGeometryInitial(); base.entities[0].dimensions = { width: 3, height: 2, depth: 2, radius: 1 };
  return { ...base, measurement: createMeasurementV2Settings(), cuts: [] };
}
export function upgradeSolidGeometryInitial(initial: SolidGeometryInitial): SolidGeometryExplorationInitial { return { ...structuredClone(initial), measurement: upgradeMeasurementSettings(initial.measurement), cuts: [] }; }
export function solidGeometryExplorationSnapshot(initial: SolidGeometryExplorationInitial): SolidGeometryExplorationSnapshot { return { ...solidGeometryExplorationInitialSchema.parse(structuredClone(initial)), cameraRevision: 0 }; }
export function solidGeometryExplorationInitial(snapshot: SolidGeometryExplorationSnapshot): SolidGeometryExplorationInitial { const { cameraRevision: _, ...initial } = snapshot; void _; return solidGeometryExplorationInitialSchema.parse(initial); }
export function createSolidCut(entity: SolidEntity, plane: SolidCutPlane): SolidCut | null {
  const parts = splitSolidByPlane(entity, plane); if (!parts) return null;
  return { id: newId(), entityId: entity.id, ...plane, cutColor: CUBE_COLORS[4], pieces: parts.map((part) => ({ position: assembledCutPiecePosition(entity, part), rotation: { ...entity.rotation }, color: entity.color, opacity: entity.opacity })) as SolidCut["pieces"] };
}
export function arrangeSolidCut(cut: SolidCut, entity: SolidEntity, apart: boolean): SolidCut {
  const parts = splitSolidByPlane(entity, cut); if (!parts) return cut;
  return { ...cut, pieces: cut.pieces.map((piece, index) => ({ ...piece, position: apart ? separatedCutPiecePosition(entity, parts[index], cut, index) : assembledCutPiecePosition(entity, parts[index]), rotation: { ...entity.rotation } })) as SolidCut["pieces"] };
}
/** 拓扑由有限原始参数派生，不进入保存内容。 */
export function solidMeshTopology(mesh: SolidMeshData) {
  const edges = new Map<string, { id: string; kind: "segment"; points: SolidEntity["position"][]; faceIds: string[] }>();
  const faces = mesh.faces.map((face) => {
    const vertices = face.indices.map((index) => mesh.vertices[index]);
    const center = vertices.reduce((sum, p) => ({ x: sum.x + p.x / vertices.length, y: sum.y + p.y / vertices.length, z: sum.z + p.z / vertices.length }), { x: 0, y: 0, z: 0 });
    const a = vertices[1], b = vertices[0], c = vertices[2], u = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }, v = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
    const n = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x }, length = Math.hypot(n.x, n.y, n.z);
    face.indices.forEach((i, index) => { const j = face.indices[(index + 1) % face.indices.length], key = [i, j].sort((a, b) => a - b).join("-"); const edge = edges.get(key); if (edge) edge.faceIds.push(face.id); else edges.set(key, { id: `edge-${key}`, kind: "segment", points: [mesh.vertices[i], mesh.vertices[j]], faceIds: [face.id] }); });
    return { id: face.id, surface: "plane" as const, vertices, center, normal: { x: n.x / length, y: n.y / length, z: n.z / length } };
  });
  return { faces, edges: [...edges.values()], vertices: mesh.vertices.map((position, index) => ({ id: `vertex-${index}`, position, faceIds: mesh.faces.filter((f) => f.indices.includes(index)).map((f) => f.id) })) };
}
export function solidExplorationObjects(state: Pick<SolidGeometryExplorationInitial, "entities" | "cuts">): { entities: SolidEntity[]; meshes: Map<string, SolidMeshData>; cutColors: Map<string, string> } {
  const meshes = new Map<string, SolidMeshData>(), cutColors = new Map<string, string>();
  const entities = state.entities.flatMap((entity) => {
    const cut = state.cuts.find((item) => item.entityId === entity.id); if (!cut) return [entity];
    const parts = splitSolidByPlane(entity, cut); if (!parts) return [entity];
    return parts.map((part, index) => { const id = solidCutPieceId(cut, index); meshes.set(id, part.mesh); cutColors.set(id, cut.cutColor); return { ...entity, ...cut.pieces[index], id }; });
  });
  return { entities, meshes, cutColors };
}
export function replaceExplorationEntity<S extends SolidGeometryExplorationInitial>(state: S, entity: SolidEntity): S {
  const cut = state.cuts.find((item) => item.pieces.some((_, index) => solidCutPieceId(item, index) === entity.id));
  if (!cut) return { ...state, entities: state.entities.map((item) => item.id === entity.id ? entity : item) };
  return { ...state, cuts: state.cuts.map((item) => item === cut ? { ...item, pieces: item.pieces.map((piece, index) => solidCutPieceId(item, index) === entity.id ? { position: entity.position, rotation: entity.rotation, color: entity.color, opacity: entity.opacity } : piece) as SolidCut["pieces"] } : item) };
}

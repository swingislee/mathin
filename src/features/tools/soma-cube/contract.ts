import { z } from "zod";
import { SOMA_IDS, SOMA_LIMIT, somaPlacementValid, type SomaPiece } from "./pieces";

export const SOMA_LEGACY_VERSION = "soma-cube-lesson-v1" as const;
export const SOMA_VERSION = "soma-cube-lesson-v2" as const;
const coordinate = z.number().int().min(-SOMA_LIMIT).max(SOMA_LIMIT);
export const somaPieceSchema = z.object({
  id: z.enum(SOMA_IDS), position: z.object({ x: coordinate, y: coordinate.min(0), z: coordinate }).strict(),
  orientation: z.number().int().min(0).max(23),
}).strict();
const snapshotShape = z.object({
  pieces: z.array(somaPieceSchema).min(1).max(7), selectedId: z.enum(SOMA_IDS),
  mode: z.enum(["observe", "assemble"]), view: z.enum(["angle", "front", "left", "right", "top"]),
  grid: z.boolean(), axes: z.boolean(), labels: z.boolean(),
  frame: z.object({ center: z.object({ x: z.number().min(-12).max(12), y: z.number().min(0).max(12), z: z.number().min(-12).max(12) }).strict(), radius: z.number().min(2.5).max(30) }).strict(),
  cameraRevision: z.number().int().min(0).max(1_000_000),
}).strict();
function validateSnapshot(state: { pieces: SomaPiece[]; selectedId: string }, ctx: z.RefinementCtx) {
  if (new Set(state.pieces.map((piece) => piece.id)).size !== state.pieces.length) ctx.addIssue({ code: "custom", path: ["pieces"], message: "Each Bao appears once." });
  if (!state.pieces.some((piece) => piece.id === state.selectedId)) ctx.addIssue({ code: "custom", path: ["selectedId"], message: "Select a piece in this assembly." });
  if (!somaPlacementValid(state.pieces)) ctx.addIssue({ code: "custom", path: ["pieces"], message: "Keep pieces within the board without overlap." });
}
export const somaLegacySnapshotSchema = snapshotShape.superRefine(validateSnapshot);
export type SomaLegacySnapshot = z.infer<typeof somaLegacySnapshotSchema>;
export type SomaSnapshot = Omit<SomaLegacySnapshot, "pieces"> & { pieces: SomaPiece[] };
export const somaFreePieceSchema = z.object({
  id: z.enum(SOMA_IDS),
  position: z.object({ x: z.number().min(-16).max(16), y: z.number().min(-16).max(16), z: z.number().min(-16).max(16) }).strict(),
  quaternion: z.tuple([z.number(), z.number(), z.number(), z.number()]).refine((q) => Math.abs(q.reduce((sum, n) => sum + n * n, 0) - 1) <= 1e-6, "Use a unit quaternion."),
}).strict();
const freeCoordinate = z.number().min(-SOMA_LIMIT).max(SOMA_LIMIT);
export const somaSnapshotSchema: z.ZodType<SomaSnapshot> = snapshotShape.extend({
  pieces: z.array(z.union([somaPieceSchema, somaFreePieceSchema])).min(1).max(7),
  frame: snapshotShape.shape.frame.extend({ center: z.object({ x: freeCoordinate, y: freeCoordinate, z: freeCoordinate }).strict() }),
}).superRefine(validateSnapshot);
export const somaLegacyToolSchema = z.object({
  toolId: z.literal("soma-cube"), contentVersion: z.literal(SOMA_LEGACY_VERSION),
  payload: z.object({ title: z.string().trim().min(1).max(80), initial: somaLegacySnapshotSchema }).strict(),
}).strict();
export const somaToolSchema = z.object({
  toolId: z.literal("soma-cube"), contentVersion: z.literal(SOMA_VERSION),
  payload: z.object({ title: z.string().trim().min(1).max(80), initial: somaSnapshotSchema }).strict(),
}).strict();

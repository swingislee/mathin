import { z } from "zod";
import { SOMA_IDS, SOMA_LIMIT, somaPlacementValid } from "./pieces";

export const SOMA_VERSION = "soma-cube-lesson-v1" as const;
const coordinate = z.number().int().min(-SOMA_LIMIT).max(SOMA_LIMIT);
export const somaPieceSchema = z.object({
  id: z.enum(SOMA_IDS), position: z.object({ x: coordinate, y: coordinate.min(0), z: coordinate }).strict(),
  orientation: z.number().int().min(0).max(23),
}).strict();
export const somaSnapshotSchema = z.object({
  pieces: z.array(somaPieceSchema).min(1).max(7), selectedId: z.enum(SOMA_IDS),
  mode: z.enum(["observe", "assemble"]), view: z.enum(["angle", "front", "left", "right", "top"]),
  grid: z.boolean(), axes: z.boolean(), labels: z.boolean(),
  frame: z.object({ center: z.object({ x: z.number().min(-12).max(12), y: z.number().min(0).max(12), z: z.number().min(-12).max(12) }).strict(), radius: z.number().min(2.5).max(30) }).strict(),
  cameraRevision: z.number().int().min(0).max(1_000_000),
}).strict().superRefine((state, ctx) => {
  if (new Set(state.pieces.map((piece) => piece.id)).size !== state.pieces.length) ctx.addIssue({ code: "custom", path: ["pieces"], message: "Each Bao appears once." });
  if (!state.pieces.some((piece) => piece.id === state.selectedId)) ctx.addIssue({ code: "custom", path: ["selectedId"], message: "Select a piece in this assembly." });
  if (!somaPlacementValid(state.pieces)) ctx.addIssue({ code: "custom", path: ["pieces"], message: "Keep pieces within the board without overlap." });
});
export type SomaSnapshot = z.infer<typeof somaSnapshotSchema>;
export const somaToolSchema = z.object({
  toolId: z.literal("soma-cube"), contentVersion: z.literal(SOMA_VERSION),
  payload: z.object({ title: z.string().trim().min(1).max(80), initial: somaSnapshotSchema }).strict(),
}).strict();

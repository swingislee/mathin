import { z } from "zod";
import { CUBE_COLORS } from "../spatial-lab/cube-structures-contract";

export const PAPER_FOLDING_VERSION = "paper-folding-v1" as const;
export const PAPER_FOLDING_LIMITS = { squares: 12, coordinate: 8, history: 60 } as const;
const point = z.object({ x: z.number().finite().min(-32).max(32), y: z.number().finite().min(-32).max(32), z: z.number().finite().min(-32).max(32) }).strict();
const squareSchema = z.object({
  id: z.string().regex(/^s_-?\d+_-?\d+$/),
  x: z.number().int().min(-8).max(8), z: z.number().int().min(-8).max(8),
  color: z.enum(CUBE_COLORS), label: z.string().max(8),
}).strict();
export type PaperSquare = z.infer<typeof squareSchema>;
export function paperSquareId(x: number, z: number) { return `s_${x}_${z}`; }
export function paperEdgeId(a: string, b: string) { return [a, b].sort().join("|"); }
export function paperAdjacencies(squares: readonly PaperSquare[]) {
  return squares.flatMap((a, index) => squares.slice(index + 1).flatMap((b) =>
    Math.abs(a.x - b.x) + Math.abs(a.z - b.z) === 1 ? [{ id: paperEdgeId(a.id, b.id), a: a.id, b: b.id }] : []));
}
export function paperLayoutProblem(squares: readonly PaperSquare[]): "limit" | "duplicate" | "disconnected" | "cycle" | null {
  if (squares.length < 1 || squares.length > PAPER_FOLDING_LIMITS.squares) return "limit";
  if (new Set(squares.map((face) => `${face.x},${face.z}`)).size !== squares.length || new Set(squares.map((face) => face.id)).size !== squares.length) return "duplicate";
  const edges = paperAdjacencies(squares), visited = new Set([squares[0].id]);
  for (let pass = 0; pass < squares.length; pass++) for (const edge of edges) {
    if (visited.has(edge.a)) visited.add(edge.b);
    if (visited.has(edge.b)) visited.add(edge.a);
  }
  if (visited.size !== squares.length) return "disconnected";
  return edges.length !== squares.length - 1 ? "cycle" : null;
}
const baseSnapshotSchema = z.object({
  version: z.literal(PAPER_FOLDING_VERSION),
  squares: z.array(squareSchema).min(1).max(PAPER_FOLDING_LIMITS.squares),
  angles: z.record(z.string().max(50), z.number().int().min(-90).max(90)),
  anchor: z.object({ faceId: z.string().max(30), vertices: z.tuple([point, point, point]) }).strict().nullable(),
  view: z.enum(["angle", "front", "left", "right", "top"]),
  labelsVisible: z.boolean(),
}).strict();
export const paperFoldingSnapshotSchema = baseSnapshotSchema.superRefine((value, ctx) => {
  const add = (message: string) => ctx.addIssue({ code: "custom", message });
  const problem = paperLayoutProblem(value.squares);
  if (problem) add(`PAPER_LAYOUT_${problem.toUpperCase()}`);
  if (value.squares.some((square) => square.id !== paperSquareId(square.x, square.z))) add("PAPER_SQUARE_ID");
  const edgeIds = new Set(paperAdjacencies(value.squares).map((edge) => edge.id));
  if (Object.keys(value.angles).length !== edgeIds.size || Object.keys(value.angles).some((id) => !edgeIds.has(id))) add("PAPER_ANGLES");
  if (value.anchor) {
    if (!value.squares.some((face) => face.id === value.anchor!.faceId)) add("PAPER_ANCHOR_FACE");
    const [a, b, c] = value.anchor.vertices;
    const d = (p: typeof a, q: typeof a) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2;
    if (Math.abs(d(a, b) - 1) > 1e-5 || Math.abs(d(b, c) - 1) > 1e-5 || Math.abs(d(a, c) - 2) > 1e-5) add("PAPER_ANCHOR_GEOMETRY");
  }
});
export type PaperFoldingSnapshot = z.infer<typeof paperFoldingSnapshotSchema>;
export const paperFoldingContentSchema = z.object({ title: z.string().trim().min(1).max(80), initial: paperFoldingSnapshotSchema }).strict();

export function createDefaultPaperFoldingSnapshot(): PaperFoldingSnapshot {
  const coordinates = [[0, 0], [1, 0], [2, 0], [3, 0], [1, -1], [1, 1]];
  const squares = coordinates.map(([x, z], index) => ({ id: paperSquareId(x, z), x, z, color: CUBE_COLORS[index], label: String(index + 1) }));
  return { version: PAPER_FOLDING_VERSION, squares, angles: Object.fromEntries(paperAdjacencies(squares).map((edge) => [edge.id, 0])), anchor: null, view: "angle", labelsVisible: true };
}

/** 参数限制只维护一张能直接折动的连通纸片，不判断它能否形成某个目标立体。 */
export function editPaperLayout(snapshot: PaperFoldingSnapshot, change: { kind: "add"; x: number; z: number } | { kind: "remove"; id: string }):
  { ok: true; snapshot: PaperFoldingSnapshot } | { ok: false; reason: "folded" | "limit" | "duplicate" | "disconnected" | "cycle" | "coordinate" } {
  if (Object.values(snapshot.angles).some((angle) => angle !== 0)) return { ok: false, reason: "folded" };
  if (change.kind === "add" && (![change.x, change.z].every(Number.isInteger) || Math.abs(change.x) > 8 || Math.abs(change.z) > 8)) return { ok: false, reason: "coordinate" };
  const squares = change.kind === "remove" ? snapshot.squares.filter((face) => face.id !== change.id) : [
    ...snapshot.squares,
    { id: paperSquareId(change.x, change.z), x: change.x, z: change.z, color: CUBE_COLORS[snapshot.squares.length % CUBE_COLORS.length],
      label: String(Math.max(0, ...snapshot.squares.map((face) => Number(face.label) || 0)) + 1) },
  ];
  const problem = paperLayoutProblem(squares);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, snapshot: { ...snapshot, squares, angles: Object.fromEntries(paperAdjacencies(squares).map((edge) => [edge.id, 0])), anchor: null } };
}

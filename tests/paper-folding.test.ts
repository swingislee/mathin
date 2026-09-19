import { describe, expect, it } from "vitest";
import { Matrix4, Vector3 } from "three";
import { CUBE_COLORS } from "@/features/tools/spatial-lab/cube-structures-contract";
import { cubeNetPaperSelection } from "@/features/tools/spatial-lab/cube-net-fold-drag";
import { createDefaultPaperFoldingSnapshot, editPaperLayout, paperAdjacencies, paperFoldingContentSchema, paperFoldingSnapshotSchema, paperSquareId, type PaperFoldingSnapshot } from "@/features/tools/paper-folding/contract";
import { paperSnapshotTransition, paperUnfoldMotion, resolvePaperFolding } from "@/features/tools/paper-folding/model";

function strip(length = 6): PaperFoldingSnapshot {
  const squares = Array.from({ length }, (_, x) => ({ id: paperSquareId(x, 0), x, z: 0, color: CUBE_COLORS[0], label: String(x + 1) }));
  return { ...createDefaultPaperFoldingSnapshot(), squares, angles: Object.fromEntries(paperAdjacencies(squares).map((edge) => [edge.id, 0])) };
}
const distance = (a: { x: number; y: number; z: number }, b: typeof a) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe("free paper folding contract", () => {
  it("round trips a non-cube six-square strip without answer or target requirements", () => {
    const initial = strip();
    expect(paperFoldingContentSchema.parse({ title: "Six squares", initial })).toEqual({ title: "Six squares", initial });
    expect(JSON.stringify(initial)).not.toMatch(/answer|target|judg|score/i);
    expect(paperFoldingSnapshotSchema.safeParse({ ...initial, answers: [] }).success).toBe(false);
  });
  it("rejects disconnected, duplicate, cyclic or oversized paper without silently rearranging it", () => {
    const initial = createDefaultPaperFoldingSnapshot(), before = JSON.stringify(initial);
    expect(editPaperLayout(initial, { kind: "add", x: 2, z: 1 })).toEqual({ ok: false, reason: "cycle" });
    expect(editPaperLayout(initial, { kind: "add", x: 0, z: 0 })).toEqual({ ok: false, reason: "duplicate" });
    expect(editPaperLayout(initial, { kind: "remove", id: "s_1_0" })).toEqual({ ok: false, reason: "disconnected" });
    expect(editPaperLayout(initial, { kind: "add", x: 20, z: 0 })).toEqual({ ok: false, reason: "coordinate" });
    expect(JSON.stringify(initial)).toBe(before);
    const malformed = { ...initial, squares: initial.squares.map((square) => ({ ...square, x: square.x + 1 })) };
    expect(paperFoldingSnapshotSchema.safeParse(malformed).success).toBe(false);
    expect(paperFoldingSnapshotSchema.safeParse({ ...initial, squares: Array(13).fill(initial.squares[0]) }).success).toBe(false);
  });
  it("adds and removes leaf squares, keeps colors and labels, and requires flat paper for layout edits", () => {
    const initial = createDefaultPaperFoldingSnapshot(), added = editPaperLayout(initial, { kind: "add", x: 4, z: 0 });
    expect(added.ok).toBe(true);
    if (!added.ok) throw new Error("expected an added square");
    expect(added.snapshot.squares.slice(0, 6)).toEqual(initial.squares);
    expect(paperFoldingSnapshotSchema.safeParse(added.snapshot).success).toBe(true);
    const removed = editPaperLayout(added.snapshot, { kind: "remove", id: "s_4_0" });
    expect(removed).toEqual({ ok: true, snapshot: initial });
    const hinge = Object.keys(initial.angles)[0];
    expect(editPaperLayout({ ...initial, angles: { ...initial.angles, [hinge]: 37 } }, { kind: "add", x: 4, z: 0 })).toEqual({ ok: false, reason: "folded" });
  });
  it("bounds angles and rigid support anchors, and rejects missing/unknown hinges", () => {
    const initial = strip();
    for (const value of [NaN, Infinity, -91, 91, 30.5]) expect(paperFoldingSnapshotSchema.safeParse({ ...initial, angles: { ...initial.angles, [Object.keys(initial.angles)[0]]: value } }).success).toBe(false);
    expect(paperFoldingSnapshotSchema.safeParse({ ...initial, angles: {} }).success).toBe(false);
    expect(paperFoldingSnapshotSchema.safeParse({ ...initial, angles: { ...initial.angles, unknown: 0 } }).success).toBe(false);
    expect(paperFoldingSnapshotSchema.safeParse({ ...initial, anchor: { faceId: initial.squares[0].id, vertices: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] } }).success).toBe(false);
  });
});

describe("open paper kinematics", () => {
  it("starts flat on X-Z and folds actual square geometry continuously", () => {
    const initial = strip(), flat = resolvePaperFolding(initial), edgeId = flat.hinges[0].edgeId;
    expect(flat.model.faces.flatMap((face) => face.vertices).every((vertex) => vertex.position.y === 0)).toBe(true);
    for (const degrees of [-90, -37, 0, 28, 90]) {
      const current = resolvePaperFolding({ ...initial, angles: { ...initial.angles, [edgeId]: degrees } });
      for (const face of current.model.faces) for (let i = 0; i < 4; i++) expect(distance(face.vertices[i].position, face.vertices[(i + 1) % 4].position)).toBeCloseTo(1, 8);
      const child = current.model.faces.find((face) => face.faceId === current.hinges[0].faceId)!;
      expect(child.centroid.y).toBeCloseTo(Math.sin(degrees * Math.PI / 180) * 0.5, 8);
    }
  });
  it("uses the existing grab-side selection so the first square is movable too", () => {
    const initial = strip(), current = resolvePaperFolding(initial), face = current.model.faces[0];
    const selection = cubeNetPaperSelection(face, current.model.faces, current.hinges, face.centroid)!;
    expect(selection.selection.movingFaceIds).toContain(face.faceId);
    expect(selection.selection.anchor.faceId).not.toBe(face.faceId);
    const changed = { ...initial, angles: { ...initial.angles, [selection.hinge.edgeId]: 60 }, anchor: { ...selection.selection.anchor, vertices: [...selection.selection.anchor.vertices] } } as PaperFoldingSnapshot;
    expect(paperFoldingSnapshotSchema.safeParse(changed).success).toBe(true);
    const next = resolvePaperFolding(changed);
    const supportBefore = current.model.faces.find((item) => item.faceId === changed.anchor!.faceId)!;
    const supportAfter = next.model.faces.find((item) => item.faceId === changed.anchor!.faceId)!;
    expect(distance(supportBefore.centroid, supportAfter.centroid)).toBeLessThan(1e-8);
    expect(distance(face.centroid, next.model.faces[0].centroid)).toBeGreaterThan(0.2);
  });
  it("keeps both ends of every connected hinge joined after multiple folds", () => {
    const initial = createDefaultPaperFoldingSnapshot();
    const angles = Object.fromEntries(Object.keys(initial.angles).map((id, index) => [id, index % 2 ? 58 : -43]));
    const result = resolvePaperFolding({ ...initial, angles });
    for (const hinge of result.hinges) {
      for (const id of [hinge.parentFaceId, hinge.faceId]) {
        const face = result.model.faces.find((candidate) => candidate.faceId === id)!;
        expect(Math.min(...face.vertices.map((vertex) => distance(vertex.position, hinge.start)))).toBeLessThan(1e-8);
        expect(Math.min(...face.vertices.map((vertex) => distance(vertex.position, hinge.end)))).toBeLessThan(1e-8);
      }
    }
  });
  it("unfolds hinges sequentially, then smoothly settles arbitrary support back onto X-Z", () => {
    const initial = strip(3), angles = Object.fromEntries(Object.keys(initial.angles).map((id) => [id, 90]));
    const root = resolvePaperFolding(initial).model.faces[0];
    const placement = new Matrix4().makeRotationX(0.65).setPosition(1, 2, 3);
    const vertices = root.vertices.slice(0, 3).map((vertex) => {
      const v = new Vector3(vertex.position.x, vertex.position.y, vertex.position.z).applyMatrix4(placement); return { x: v.x, y: v.y, z: v.z };
    }) as NonNullable<PaperFoldingSnapshot["anchor"]>["vertices"];
    const from = { ...initial, angles, anchor: { faceId: root.faceId, vertices } }, motion = paperUnfoldMotion(from);
    const halfway = motion.sample(220);
    expect(Object.values(halfway.angles).filter((value) => value === 90)).toHaveLength(1);
    expect(Object.values(halfway.angles).filter((value) => value > 0 && value < 90)).toHaveLength(1);
    const settling = resolvePaperFolding(motion.sample(1100)).model.faces[0].centroid;
    expect(settling.y).toBeGreaterThan(0); expect(settling.y).toBeLessThan(2);
    expect(motion.sample(motion.durationMs)).toEqual(motion.target);
    expect(paperFoldingSnapshotSchema.safeParse(motion.target).success).toBe(true);
    expect(resolvePaperFolding(motion.target).model.faces.flatMap((face) => face.vertices).every((vertex) => Math.abs(vertex.position.y) < 1e-8)).toBe(true);
  });
  it("reconstructs a smooth classroom transition and leaves late-join snapshots self-contained", () => {
    const from = strip(), id = Object.keys(from.angles)[0], to = { ...from, angles: { ...from.angles, [id]: 90 } };
    const motion = paperSnapshotTransition(from, to)!;
    expect(motion.sample(0).angles[id]).toBe(0);
    expect(motion.sample(motion.durationMs / 2).angles[id]).toBeCloseTo(45);
    expect(motion.sample(motion.durationMs)).toEqual(to);
    expect(resolvePaperFolding(paperFoldingSnapshotSchema.parse(JSON.parse(JSON.stringify(to)))).model.faces).toEqual(resolvePaperFolding(to).model.faces);
    const unfold = paperSnapshotTransition(to, from)!;
    expect(unfold.sample(unfold.durationMs)).toEqual(from);
    expect(paperSnapshotTransition(from, { ...from, labelsVisible: false })).toBeNull();
  });
});

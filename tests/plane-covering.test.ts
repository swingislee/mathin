import { describe, expect, it } from "vitest";
import { addCoverPiece, canPlaceCover, clearCoverPieces, coverCounts, coverIds, coverInTray, coverOnBoard, coverPiece, coverPieces, COVER_CELL, createCoverState, dragCover, duplicateCover, parkCover, removeCover, resizeCoverBoard, setCoverField, settleCover, tapCover, turnCover } from "@/features/tools/plane-covering/model";
import { isValidCoverState } from "@/features/tools/plane-covering/validation";
import { planeCoveringScene as definition } from "@/features/tools/plane-covering/scene";
import { planarSnapshot, planarSnapshotForTool, planarStateSchema, type PlanarPoint, type PlanarState } from "@/features/tools/planar-kit/contract";
import { planarCommit, planarFrame, planarHistory } from "@/features/tools/planar-kit/presentation";

const relocate = (state: PlanarState, id: number, at: PlanarPoint) => ({ ...state, points: { ...state.points, [`piece.${id}`]: at, [`home.${id}`]: at } });
describe("editable checkerboard and domino materials", () => {
  it("starts with an empty 8 by 8 board and keeps mathematical colouring separate from the host grid", () => {
    const state = createCoverState();
    expect(state.params).toEqual({ columns: 8, rows: 8, nextId: 0, active: -1 });
    expect(definition.referenceGrid).toBe(false); expect(state.flags.grid).toBe(false); expect(state.flags.measures).toBe(false);
    expect(coverCounts(state)).toMatchObject({ dark: 32, light: 32, missing: 0, placed: 0, waiting: 0 });
    expect(planarStateSchema.safeParse(state).success).toBe(true);
  });
  it("resizes through odd, narrow and maximum boards using true colour counts", () => {
    const initial = createCoverState();
    for (const [columns, rows, dark, light] of [[1, 1, 1, 0], [3, 3, 5, 4], [1, 12, 6, 6], [12, 12, 72, 72]]) {
      const next = resizeCoverBoard(initial, columns, rows);
      expect(isValidCoverState(next)).toBe(true); expect(coverCounts(next)).toMatchObject({ dark, light });
    }
    for (const value of [0, 13, 2.5, NaN]) expect(setCoverField(initial, "columns", value)).toBe(initial);
  });
  it("adds and duplicates individual dominoes, retires deleted IDs, and allows zero materials", () => {
    const initial = addCoverPiece(createCoverState()), duplicate = duplicateCover(initial, "piece.0"), removed = removeCover(duplicate, "piece.0");
    expect(coverIds(duplicate)).toEqual([0, 1]); expect(duplicate.points["piece.0"]).toEqual(initial.points["piece.0"]);
    expect(coverIds(removed)).toEqual([1]); expect(removed.params.active).toBe(1);
    const fresh = addCoverPiece(clearCoverPieces(removed));
    expect(coverIds(fresh)).toEqual([2]); expect(isValidCoverState(clearCoverPieces(fresh))).toBe(true);
    expect(definition.selectionAfterChange!(initial, duplicate, "piece.0")).toBe("piece.1");
    expect(definition.selectionAfterChange!(duplicate, clearCoverPieces(duplicate), "piece.1")).toBeNull();
  });
  it("removes and restores only empty cells and updates dark/light counts accurately", () => {
    let state = addCoverPiece(createCoverState()); state = { ...state, flags: { ...state.flags, editCells: true } };
    expect(tapCover(state, "cell.0_0")).toBe(state);
    const removed = tapCover(state, "cell.2_0");
    expect(removed.marks).toEqual(["missing.2_0"]); expect(coverCounts(removed)).toMatchObject({ dark: 31, light: 32, coveredDark: 1, coveredLight: 1 });
    expect(tapCover(removed, "cell.2_0").marks).toEqual([]);
    expect(isValidCoverState(removed)).toBe(true);
  });
  it("keeps free drag frames local, snaps to legal cells, and returns collisions and missing cells to the last exact point", () => {
    const initial = addCoverPiece(addCoverPiece(createCoverState())), source = initial.points["piece.1"];
    const preview = dragCover(initial, "piece.1", { x: 10, y: COVER_CELL + 9 });
    expect(preview.points["piece.1"]).not.toEqual(source); expect(preview.points["home.1"]).toEqual(source); expect(isValidCoverState(preview)).toBe(false);
    const settled = settleCover(preview, "piece.1")!;
    expect(settled.points["piece.1"]).toEqual({ x: 2, y: 1 }); expect(isValidCoverState(settled)).toBe(true);
    const snap = planarCommit(planarSnapshot(initial), preview, settled, { id: "snap", duration: 180, now: 1000 });
    // 手势起点才进入 undo；自由点位只作为短吸附动画的 from。
    snap.past = [initial];
    expect(planarSnapshotForTool("plane-covering", "plane-covering-lesson-v2").safeParse(snap).success).toBe(true);
    expect(settleCover(dragCover(initial, "piece.1", { x: -2 * COVER_CELL, y: 0 }), "piece.1")!.points["piece.1"]).toEqual(source);
    const withHole = { ...initial, marks: ["missing.2_1"] };
    expect(settleCover(dragCover(withHole, "piece.1", { x: 0, y: COVER_CELL }), "piece.1")!.points["piece.1"]).toEqual(source);
  });
  it("parks clipped pieces when shrinking and retains legal board pieces, IDs, holes and undo", () => {
    let state = addCoverPiece(addCoverPiece(createCoverState())); state = relocate(state, 1, { x: 6, y: 7 });
    state = { ...state, marks: ["missing.2_2", "missing.7_6"] };
    const resized = resizeCoverBoard(state, 4, 4);
    expect(coverOnBoard(resized, coverPiece(resized, 0)!)).toBe(true);
    expect(coverInTray(resized, coverPiece(resized, 1)!)).toBe(true);
    expect(resized.points["piece.1"]).toEqual(resized.points["home.1"]);
    expect(coverIds(resized)).toEqual([0, 1]); expect(resized.marks).toEqual(["missing.2_2"]); expect(resized.params.active).toBe(state.params.active);
    expect(isValidCoverState(resized)).toBe(true);
    expect(planarHistory(planarCommit(planarSnapshot(state), state, resized), "undo").current).toEqual(state);
  });
  it("moves supply pieces back onto the board by the same drag/snap and prevents invalid rotations", () => {
    const initial = addCoverPiece(createCoverState()), parked = parkCover(initial, "piece.0"), piece = coverPiece(parked)!;
    expect(coverCounts(parked).waiting).toBe(1); expect(isValidCoverState(parked)).toBe(true);
    const placed = settleCover(dragCover(parked, "piece.0", { x: -piece.at.x * COVER_CELL, y: -piece.at.y * COVER_CELL }), "piece.0")!;
    expect(placed.points["piece.0"]).toEqual({ x: 0, y: 0 });
    const rotated = turnCover(placed, "piece.0"); expect(rotated.params["angle.0"]).toBe(90); expect(isValidCoverState(rotated)).toBe(true);
    const blocked = { ...placed, marks: ["missing.0_1"] }; expect(turnCover(blocked, "piece.0")).toBe(blocked);
    expect(canPlaceCover(placed, { id: 0, at: { x: 7, y: 7 }, angle: 90 })).toBe(false);
    const snapshot = planarCommit(planarSnapshot(placed), placed, rotated, { id: "cover-turn", duration: 450, now: 1000 });
    expect(planarFrame(snapshot, definition, 1225).params["angle.0"]).toBe(45);
    expect(planarFrame(snapshot, definition, 1450)).toEqual(rotated);
  });
  it("covers a maximum board with 72 pieces, including the last row, without overlap or a solver", () => {
    let state = resizeCoverBoard(createCoverState(), 12, 12);
    for (let i = 0; i < 72; i++) state = addCoverPiece(state);
    expect(coverCounts(state)).toMatchObject({ dark: 72, light: 72, coveredDark: 72, coveredLight: 72, placed: 72, waiting: 0 });
    expect(coverPiece(state, 71)?.at.y).toBe(11); expect(addCoverPiece(state)).toBe(state);
    expect(isValidCoverState(state)).toBe(true); expect(planarStateSchema.safeParse(state).success).toBe(true);
  });
  it("rejects overlaps, holes, fractional endpoints, spare keys and broken last-position references", () => {
    const state = addCoverPiece(addCoverPiece(createCoverState()));
    for (const invalid of [
      relocate(state, 1, { x: 0, y: 0 }), relocate(state, 1, { x: 7, y: 7 }), relocate(state, 1, { x: 2.1, y: 0 }),
      { ...state, marks: ["missing.0_0"] }, { ...state, marks: ["missing.2_1", "missing.2_1"] },
      { ...state, params: { ...state.params, active: 100 } }, { ...state, params: { ...state.params, "angle.0": 45 } },
      { ...state, points: { ...state.points, "home.0": { x: 0, y: 1 } } }, { ...state, params: { ...state.params, unsafe: 1 } },
    ]) expect(isValidCoverState(invalid)).toBe(false);
  });
  it("keeps a mixed lifecycle and repeated board resizes strictly serializable", () => {
    let state = createCoverState();
    for (let i = 0; i < 36; i++) {
      state = addCoverPiece(state, i % 2 ? 90 : 0);
      if (i % 3 === 0) state = resizeCoverBoard(state, 1 + i % 12, 1 + (i * 7) % 12);
      if (i % 4 === 0) state = parkCover(state, `piece.${state.params.active}`);
      if (i % 5 === 0) state = removeCover(state, `piece.${state.params.active}`);
      expect(isValidCoverState(state), `iteration ${i}`).toBe(true);
      expect(coverPieces(state).every((piece) => coverOnBoard(state, piece) || coverInTray(state, piece))).toBe(true);
    }
  });
});

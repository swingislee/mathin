import { addMatchMaterial, captureMatchReference, clearMatches, createMatchState, duplicateMatch, removeMatch, setMatchField } from "../../src/features/tools/plane-matchsticks/model";
import { addCoverPiece, clearCoverPieces, createCoverState, parkCover, resizeCoverBoard, tapCover, turnCover } from "../../src/features/tools/plane-covering/model";
import type { PlanarState } from "../../src/features/tools/planar-kit/contract";

export interface CoverMatchCase { label: string; scene: { toolId: string; contentVersion: string; payload: { title: string; initial: PlanarState } }; accepted: boolean }
/** 同一批领域样例供 TypeScript 与本机 PostgreSQL 回滚检查消费，无身份或业务数据。 */
export function coverMatchCases(): CoverMatchCase[] {
  const cases: CoverMatchCase[] = [];
  const add = (label: string, initial: PlanarState, accepted = true) => { const toolId = initial.sceneId === "51-create" ? "plane-matchsticks" : "plane-covering"; cases.push({ label, scene: { toolId, contentVersion: `${toolId}-lesson-v2`, payload: { title: "Open classroom materials", initial } }, accepted }); };
  const mutate = (label: string, state: PlanarState, fn: (draft: PlanarState) => void) => { const draft = structuredClone(state); fn(draft); add(label, draft, false); };
  const stick = createMatchState(), board = createCoverState(), domino = addCoverPiece(board);
  add("match-default", stick); add("match-empty", clearMatches(stick));
  let many = stick;
  for (const material of ["triangle", "square", "shared"] as const) { many = addMatchMaterial(many, material); add(`match-append-${material}`, many); }
  add("match-fractional-angle", setMatchField(stick, "angle", -27.125));
  add("match-reference-without-original", removeMatch(captureMatchReference(stick), "stick.0"));
  add("match-copy-reference", captureMatchReference(duplicateMatch(stick, "stick.0")));
  for (const [key, value] of [["angle", -36000], ["angle", 36000], ["x", 40], ["x", 920], ["y", 40], ["y", 680]] as const) add(`match-boundary-${key}-${value}`, setMatchField(stick, key, value));
  many = clearMatches(stick); for (let i = 0; i < 96; i++) many = addMatchMaterial(many, "single");
  add("match-capacity-and-reference", captureMatchReference(many));
  mutate("match-capacity-overflow", many, (s) => { const id = s.params.nextId++; s.params[`angle.${id}`] = 0; s.points[`stick.${id}`] = { x: 400, y: 330 }; });
  for (const value of [-1, 0.5, 100000]) mutate(`match-next-id-${value}`, stick, (s) => { s.params.nextId = value; });
  for (const value of [-36001, 36001]) mutate(`match-angle-${value}`, stick, (s) => { s.params["angle.0"] = value; });
  for (const [key, value] of [["x", 39], ["x", 921], ["y", 39], ["y", 681]] as const) mutate(`match-point-${key}-${value}`, stick, (s) => { s.points["stick.0"][key] = value; });
  mutate("match-missing-point", stick, (s) => { delete s.points["stick.0"]; });
  mutate("match-noncanonical-id", stick, (s) => { s.params["angle.00"] = s.params["angle.0"]; delete s.params["angle.0"]; });
  mutate("match-unknown-reference", stick, (s) => { s.points["reference.0"] = { x: 400, y: 330 }; });
  add("cover-default", board); add("cover-one", domino); add("cover-empty-after-use", clearCoverPieces(domino));
  add("cover-vertical", turnCover(domino, "piece.0")); add("cover-supply", parkCover(domino, "piece.0"));
  for (const [cols, rows] of [[1, 1], [1, 12], [12, 1], [3, 3], [12, 12]]) { const resized = resizeCoverBoard(board, cols, rows); add(`cover-board-${cols}-${rows}`, resized); add(`cover-piece-${cols}-${rows}`, addCoverPiece(resized)); }
  let covered = resizeCoverBoard(board, 12, 12); for (let i = 0; i < 72; i++) covered = addCoverPiece(covered);
  add("cover-capacity-and-last-row", covered); add("cover-shrink-preserves-all-materials", resizeCoverBoard(covered, 1, 1));
  let holes: PlanarState = { ...board, flags: { ...board.flags, editCells: true } };
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) holes = tapCover(holes, `cell.${x}_${y}`);
  add("cover-all-cells-removed", holes); add("cover-supply-without-cells", addCoverPiece(holes));
  mutate("cover-capacity-overflow", covered, (s) => { const id = s.params.nextId++; s.params[`angle.${id}`] = 0; s.points[`piece.${id}`] = s.points[`home.${id}`] = { x: 13, y: 0 }; });
  for (const key of ["columns", "rows"]) for (const value of [0, 13, 1.5]) mutate(`cover-${key}-${value}`, board, (s) => { s.params[key] = value; });
  mutate("cover-overlap", addCoverPiece(domino), (s) => { s.points["piece.1"] = s.points["home.1"] = { ...s.points["piece.0"] }; });
  mutate("cover-missing-under-domino", domino, (s) => { s.marks = ["missing.0_0"]; });
  mutate("cover-duplicate-missing", board, (s) => { s.marks = ["missing.0_0", "missing.0_0"]; });
  for (const key of ["missing.8_0", "missing.0_8", "missing.00_0", "missing.-1_0", "other.0_0"]) mutate(`cover-${key}`, board, (s) => { s.marks = [key]; });
  for (const at of [{ x: 7, y: 7 }, { x: 8, y: 0 }, { x: 2.5, y: 0 }, { x: -1, y: 0 }, { x: 13, y: 0 }, { x: 9, y: 7 }]) mutate(`cover-point-${at.x}-${at.y}`, domino, (s) => { s.points["piece.0"] = s.points["home.0"] = at; });
  mutate("cover-stale-home", domino, (s) => { s.points["home.0"] = { x: 1, y: 0 }; });
  mutate("cover-fractional-turn", domino, (s) => { s.params["angle.0"] = 45; });
  for (const state of [stick, domino]) {
    for (const key of ["unexpected", "angle.99999"]) mutate(`${state.sceneId}-extra-param-${key}`, state, (s) => { s.params[key] = 1; });
    mutate(`${state.sceneId}-extra-point`, state, (s) => { s.points.other = { x: 100, y: 100 }; });
    mutate(`${state.sceneId}-extra-flag`, state, (s) => { s.flags.other = true; });
    mutate(`${state.sceneId}-missing-flag`, state, (s) => { delete s.flags.measures; });
    mutate(`${state.sceneId}-phase`, state, (s) => { s.phase = 0.5; });
    mutate(`${state.sceneId}-active`, state, (s) => { s.params.active = 500; });
    const legacy = cases.find((item) => item.scene.payload.initial === state)!;
    cases.push({ ...structuredClone(legacy), label: `${state.sceneId}-wrong-version`, accepted: false, scene: { ...legacy.scene, contentVersion: `${legacy.scene.toolId}-lesson-v1` } });
    cases.push({ ...structuredClone(legacy), label: `${state.sceneId}-empty-title`, accepted: false, scene: { ...legacy.scene, payload: { ...legacy.scene.payload, title: "" } } });
  }
  return cases;
}

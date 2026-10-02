import type { PlanarPoint, PlanarState } from "../planar-kit/contract";

export const COVER_SCENE = "57-create";
export const COVER_LIMIT = 72;
export const COVER_CELL = 44;
export const COVER_FLAGS = ["grid", "measures", "coloring", "editCells", "labels"] as const;
export interface CoverPiece { id: number; at: PlanarPoint; angle: number }
export const coverIds = (state: PlanarState) => Object.keys(state.params).filter((key) => key.startsWith("angle.")).map((key) => Number(key.slice(6))).sort((a, b) => a - b);
export const coverPieces = (state: PlanarState): CoverPiece[] => coverIds(state).map((id) => ({ id, at: state.points[`piece.${id}`], angle: state.params[`angle.${id}`] }));
export function coverTarget(target: string | null): number | null { const match = /^piece\.(0|[1-9]\d{0,4})$/.exec(target ?? ""); return match ? Number(match[1]) : null; }
export const coverPiece = (state: PlanarState, id = state.params.active) => coverPieces(state).find((piece) => piece.id === id) ?? null;
export const coverOrigin = (state: PlanarState) => ({ x: 360 - state.params.columns * COVER_CELL / 2, y: 340 - state.params.rows * COVER_CELL / 2 });
export function coverToStage(state: PlanarState, point: PlanarPoint): PlanarPoint { const origin = coverOrigin(state); return { x: origin.x + (point.x + 0.5) * COVER_CELL, y: origin.y + (point.y + 0.5) * COVER_CELL }; }
export const coverCells = (piece: CoverPiece): PlanarPoint[] => [piece.at, { x: piece.at.x + (piece.angle === 90 ? 0 : 1), y: piece.at.y + (piece.angle === 90 ? 1 : 0) }];
export const missingCellKey = (point: PlanarPoint) => `missing.${point.x}_${point.y}`;
export const coverOnBoard = (state: PlanarState, piece: CoverPiece) => coverCells(piece).every((cell) => cell.x >= 0 && cell.x < state.params.columns && cell.y >= 0 && cell.y < state.params.rows);
export const trayMaxRow = (state: PlanarState) => Math.max(3, state.params.rows - 2);
export function coverInTray(state: PlanarState, piece: CoverPiece) { return piece.at.x >= state.params.columns + 1 && piece.at.x <= state.params.columns + 4 && piece.at.y >= 0 && piece.at.y <= trayMaxRow(state); }
const sameCell = (a: PlanarPoint, b: PlanarPoint) => a.x === b.x && a.y === b.y;
export function canPlaceCover(state: PlanarState, piece: CoverPiece): boolean {
  if (![piece.at.x, piece.at.y].every(Number.isInteger) || (piece.angle !== 0 && piece.angle !== 90)) return false;
  if (coverInTray(state, piece)) return true;
  if (!coverOnBoard(state, piece)) return false;
  const occupied = coverPieces(state).filter((other) => other.id !== piece.id && coverOnBoard(state, other)).flatMap(coverCells);
  return coverCells(piece).every((cell) => !state.marks.includes(missingCellKey(cell)) && !occupied.some((other) => sameCell(cell, other)));
}
function trayPoint(state: PlanarState, id: number, angle: number): PlanarPoint {
  const occupied = coverPieces(state).filter((other) => other.id !== id && coverInTray(state, other)).flatMap(coverCells);
  for (let row = 0; row <= trayMaxRow(state); row++) for (const column of [state.params.columns + 1, state.params.columns + 3]) {
    const piece = { id, angle, at: { x: column, y: row } };
    if (!coverCells(piece).some((cell) => occupied.some((other) => sameCell(cell, other)))) return piece.at;
  }
  // 待用区堆叠仍保留每块材料与编号；棋盘落点始终独占。
  return { x: state.params.columns + 1 + 2 * (id % 2), y: Math.floor(id / 2) % (trayMaxRow(state) + 1) };
}
function firstCoverPosition(state: PlanarState, id: number, angle: number): PlanarPoint {
  for (let y = 0; y < state.params.rows; y++) for (let x = 0; x < state.params.columns; x++) if (canPlaceCover(state, { id, angle, at: { x, y } })) return { x, y };
  return trayPoint(state, id, angle);
}
function writeCoverPiece(state: PlanarState, piece: CoverPiece): PlanarState {
  return { ...state, params: { ...state.params, active: piece.id, [`angle.${piece.id}`]: piece.angle }, points: { ...state.points, [`piece.${piece.id}`]: { ...piece.at }, [`home.${piece.id}`]: { ...piece.at } } };
}
export function addCoverPiece(state: PlanarState, angle = 0): PlanarState {
  const id = state.params.nextId;
  if (coverIds(state).length >= COVER_LIMIT || id >= 99999 || ![0, 90].includes(angle)) return state;
  return writeCoverPiece({ ...state, params: { ...state.params, nextId: id + 1 } }, { id, angle, at: firstCoverPosition(state, id, angle) });
}
export function createCoverState(): PlanarState {
  return { sceneId: COVER_SCENE, params: { columns: 8, rows: 8, nextId: 0, active: -1 }, points: {}, flags: { grid: false, measures: false, coloring: true, editCells: false, labels: false }, marks: [], phase: 0 };
}
export function selectCover(state: PlanarState, target: string | null): PlanarState {
  const id = coverTarget(target);
  return id !== null && coverPiece(state, id) ? { ...state, params: { ...state.params, active: id } } : state;
}
export function tapCover(state: PlanarState, target: string): PlanarState {
  const selected = selectCover(state, target);
  if (selected !== state) return selected;
  const match = /^cell\.(\d+)_(\d+)$/.exec(target);
  if (!state.flags.editCells || !match) return state;
  const cell = { x: Number(match[1]), y: Number(match[2]) };
  if (cell.x >= state.params.columns || cell.y >= state.params.rows || coverPieces(state).filter((piece) => coverOnBoard(state, piece)).flatMap(coverCells).some((point) => sameCell(point, cell))) return state;
  const key = missingCellKey(cell);
  return { ...state, marks: state.marks.includes(key) ? state.marks.filter((mark) => mark !== key) : [...state.marks, key] };
}
export function duplicateCover(state: PlanarState, target: string | null): PlanarState { const id = coverTarget(target), piece = id === null ? null : coverPiece(state, id); return piece ? addCoverPiece(state, piece.angle) : state; }
export function removeCover(state: PlanarState, target: string | null): PlanarState {
  const id = coverTarget(target);
  if (id === null || !coverPiece(state, id)) return state;
  const params = { ...state.params }, points = { ...state.points };
  delete params[`angle.${id}`]; delete points[`piece.${id}`]; delete points[`home.${id}`];
  params.active = coverIds(state).find((other) => other !== id) ?? -1;
  return { ...state, params, points };
}
export function parkCover(state: PlanarState, target: string | null): PlanarState {
  const id = coverTarget(target), piece = id === null ? null : coverPiece(state, id);
  return piece && !coverInTray(state, piece) ? writeCoverPiece(state, { ...piece, at: trayPoint(state, piece.id, piece.angle) }) : state;
}
export function clearCoverPieces(state: PlanarState): PlanarState { return { ...state, params: { columns: state.params.columns, rows: state.params.rows, nextId: state.params.nextId, active: -1 }, points: {} }; }
export function turnCover(state: PlanarState, target: string | null): PlanarState {
  const id = coverTarget(target), piece = id === null ? null : coverPiece(state, id);
  if (!piece) return state;
  const next = { ...piece, angle: piece.angle === 90 ? 0 : 90 };
  return canPlaceCover(state, next) ? writeCoverPiece(state, next) : state;
}
/** 改棋盘不丢骨牌：格坐标保持，失去支撑的材料移到待用区；移出范围的缺格可撤销恢复。 */
export function resizeCoverBoard(state: PlanarState, columns: number, rows: number): PlanarState {
  if (![columns, rows].every((n) => Number.isInteger(n) && n >= 1 && n <= 12) || columns === state.params.columns && rows === state.params.rows) return state;
  let next: PlanarState = { ...state, params: { ...state.params, columns, rows }, points: { ...state.points }, marks: state.marks.filter((mark) => { const [x, y] = mark.slice(8).split("_").map(Number); return x < columns && y < rows; }) };
  for (const piece of coverPieces(state)) {
    const keep = coverOnBoard(state, piece) && coverOnBoard(next, piece);
    next = writeCoverPiece(next, { ...piece, at: keep ? piece.at : trayPoint(next, piece.id, piece.angle) });
  }
  return { ...next, params: { ...next.params, active: state.params.active } };
}
export function setCoverField(state: PlanarState, key: string, value: number): PlanarState {
  if (!Number.isFinite(value) || !Number.isInteger(value)) return state;
  if (key === "columns" || key === "rows") return resizeCoverBoard(state, key === "columns" ? value : state.params.columns, key === "rows" ? value : state.params.rows);
  const piece = coverPiece(state);
  if (!piece || !["column", "row"].includes(key)) return state;
  const next = { ...piece, at: { ...piece.at, [key === "column" ? "x" : "y"]: value } };
  return canPlaceCover(state, next) ? writeCoverPiece(state, next) : state;
}
export function dragCover(state: PlanarState, target: string, delta: PlanarPoint): PlanarState {
  const id = coverTarget(target), piece = id === null ? null : coverPiece(state, id);
  if (!piece) return state;
  // home 始终保存上次合法格点；松手失败回到该点，过程帧不进入数学现场。
  return { ...state, params: { ...state.params, active: piece.id }, points: { ...state.points, [`piece.${piece.id}`]: { x: Math.max(-2, Math.min(state.params.columns + 6, piece.at.x + delta.x / COVER_CELL)), y: Math.max(-2, Math.min(14, piece.at.y + delta.y / COVER_CELL)) } } };
}
export function settleCover(state: PlanarState, target: string): PlanarState | null {
  const id = coverTarget(target), piece = id === null ? null : coverPiece(state, id);
  if (!piece) return null;
  const candidate = { ...piece, at: { x: Math.round(piece.at.x), y: Math.round(piece.at.y) } };
  return writeCoverPiece(state, canPlaceCover(state, candidate) ? candidate : { ...piece, at: state.points[`home.${piece.id}`] });
}
export function coverCounts(state: PlanarState) {
  const result = { dark: 0, light: 0, coveredDark: 0, coveredLight: 0, missing: state.marks.length, placed: 0, waiting: 0 };
  const placed = coverPieces(state).filter((piece) => coverOnBoard(state, piece));
  const occupied = new Set(placed.flatMap(coverCells).map(missingCellKey));
  result.placed = placed.length; result.waiting = coverIds(state).length - placed.length;
  for (let y = 0; y < state.params.rows; y++) for (let x = 0; x < state.params.columns; x++) {
    const key = missingCellKey({ x, y });
    if (state.marks.includes(key)) continue;
    const dark = (x + y) % 2 === 0;
    result[dark ? "dark" : "light"]++;
    if (occupied.has(key)) result[dark ? "coveredDark" : "coveredLight"]++;
  }
  return result;
}
export function coverBounds(state: PlanarState, piece: CoverPiece) {
  const corners = coverCells(piece).map((point) => coverToStage(state, point));
  return { minX: Math.min(...corners.map((point) => point.x)) - COVER_CELL / 2, maxX: Math.max(...corners.map((point) => point.x)) + COVER_CELL / 2, minY: Math.min(...corners.map((point) => point.y)) - COVER_CELL / 2, maxY: Math.max(...corners.map((point) => point.y)) + COVER_CELL / 2 };
}

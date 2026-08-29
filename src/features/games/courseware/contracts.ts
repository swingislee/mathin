import {
  createDefaultSudokuAuthoredPayload,
  createDefaultSudokuActivityPayload,
  sudokuActivityPayloadSchema,
  sudokuAuthoredPayloadSchema,
  type SudokuActivityPayload,
  type SudokuAuthoredPayload,
} from "../sudoku/courseware-contract";
import { getGameCoursewareContract } from "./registry";

export type GameCoursewarePayload = SudokuAuthoredPayload | SudokuActivityPayload;

export function parseGameCoursewarePayload(
  gameId: string,
  contentVersion: string,
  payload: unknown,
): GameCoursewarePayload {
  const contract = getGameCoursewareContract(gameId, contentVersion);
  if (!contract) throw new Error("UNKNOWN_GAME_COURSEWARE_CONTRACT");
  switch (`${contract.gameId}:${contract.contentVersion}`) {
    case "sudoku:sudoku-authored-v1":
      return sudokuAuthoredPayloadSchema.parse(payload);
    case "sudoku:sudoku-authored-v2":
      return sudokuActivityPayloadSchema.parse(payload);
    default:
      throw new Error("UNKNOWN_GAME_COURSEWARE_CONTRACT");
  }
}

export function createDefaultGameCoursewarePayload(
  gameId: string,
  contentVersion: string,
): GameCoursewarePayload {
  const contract = getGameCoursewareContract(gameId, contentVersion);
  if (!contract) throw new Error("UNKNOWN_GAME_COURSEWARE_CONTRACT");
  switch (`${contract.gameId}:${contract.contentVersion}`) {
    case "sudoku:sudoku-authored-v1":
      return createDefaultSudokuAuthoredPayload();
    case "sudoku:sudoku-authored-v2":
      return createDefaultSudokuActivityPayload();
    default:
      throw new Error("UNKNOWN_GAME_COURSEWARE_CONTRACT");
  }
}

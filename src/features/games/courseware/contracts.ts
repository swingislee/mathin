import {
  createDefaultSudokuAuthoredPayload,
  sudokuAuthoredPayloadSchema,
  type SudokuAuthoredPayload,
} from "../sudoku/courseware-contract";
import { getGameCoursewareContract } from "./registry";

export type GameCoursewarePayload = SudokuAuthoredPayload;

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
    default:
      throw new Error("UNKNOWN_GAME_COURSEWARE_CONTRACT");
  }
}


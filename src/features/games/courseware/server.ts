import "server-only";

import { createHash } from "node:crypto";
import type { GamePageValidation } from "@/features/courseware-doc/game-page-schema";
import { analyzeSudokuPuzzle } from "../sudoku/logic";
import type { SudokuAuthoredPayload } from "../sudoku/courseware-contract";
import { parseGameCoursewarePayload } from "./contracts";
import { getGameCoursewareContract } from "./registry";

export interface TrustedGameCoursewareContent {
  payload: ReturnType<typeof parseGameCoursewarePayload>;
  validation: GamePageValidation;
}

export function validateGameCoursewareContent(
  gameId: string,
  contentVersion: string,
  payload: unknown,
): TrustedGameCoursewareContent {
  const contract = getGameCoursewareContract(gameId, contentVersion);
  if (!contract) throw new Error("UNKNOWN_GAME_COURSEWARE_CONTRACT");
  const normalized = parseGameCoursewarePayload(gameId, contentVersion, payload);
  const payloadHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");

  switch (`${contract.gameId}:${contract.contentVersion}`) {
    case "sudoku:sudoku-authored-v1": {
      const sudoku = normalized as SudokuAuthoredPayload;
      const analysis = analyzeSudokuPuzzle(sudoku.puzzle, sudoku.variantId);
      return {
        payload: sudoku,
        validation: {
          payloadHash,
          validatorVersion: contract.validatorVersion,
          publishable: analysis.status === "unique",
          code: analysis.status,
          details: analysis,
        },
      };
    }
    default:
      throw new Error("UNKNOWN_GAME_COURSEWARE_CONTRACT");
  }
}


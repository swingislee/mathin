import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { gamePageDocSchema } from "@/features/courseware-doc/game-page-schema";
import {
  createDefaultGameCoursewarePayload,
  parseGameCoursewarePayload,
} from "@/features/games/courseware/contracts";
import {
  GAME_COURSEWARE_CONTRACTS,
  gameCoursewareContractsForSurface,
  getGameCoursewareContract,
} from "@/features/games/courseware/registry";
import { validateGameCoursewareContent } from "@/features/games/courseware/server";

const SOLUTIONS = {
  "classic-4x4": [
    1, 2, 3, 4,
    3, 4, 1, 2,
    2, 1, 4, 3,
    4, 3, 2, 1,
  ],
  "classic-6x6": [
    1, 2, 3, 4, 5, 6,
    4, 5, 6, 1, 2, 3,
    2, 3, 4, 5, 6, 1,
    5, 6, 1, 2, 3, 4,
    3, 4, 5, 6, 1, 2,
    6, 1, 2, 3, 4, 5,
  ],
  "classic-9x9": [
    1, 2, 3, 4, 5, 6, 7, 8, 9,
    4, 5, 6, 7, 8, 9, 1, 2, 3,
    7, 8, 9, 1, 2, 3, 4, 5, 6,
    2, 3, 4, 5, 6, 7, 8, 9, 1,
    5, 6, 7, 8, 9, 1, 2, 3, 4,
    8, 9, 1, 2, 3, 4, 5, 6, 7,
    3, 4, 5, 6, 7, 8, 9, 1, 2,
    6, 7, 8, 9, 1, 2, 3, 4, 5,
    9, 1, 2, 3, 4, 5, 6, 7, 8,
  ],
} as const;

const display = {
  showCoordinates: true,
  allowCandidates: true,
  allowAnswerReveal: false,
  showTeachingTools: true,
};

describe("registry-backed game courseware contract", () => {
  it("exposes authoring through the manifest instead of microcourse conditionals", () => {
    expect(gameCoursewareContractsForSurface("microcourse")).toEqual(GAME_COURSEWARE_CONTRACTS);
    expect(getGameCoursewareContract("sudoku", "sudoku-authored-v1")).toMatchObject({
      validatorVersion: "sudoku-authored-v1@1",
      copyable: true,
    });
    expect(() => createDefaultGameCoursewarePayload("future-game", "future-v1"))
      .toThrow("UNKNOWN_GAME_COURSEWARE_CONTRACT");
  });

  for (const [variantId, complete] of Object.entries(SOLUTIONS)) {
    it(`validates and parses a unique ${variantId} authored page`, () => {
      const puzzle: number[] = [...complete];
      puzzle[puzzle.length - 1] = 0;
      const trusted = validateGameCoursewareContent("sudoku", "sudoku-authored-v1", {
        kind: "authored",
        variantId,
        puzzle,
        display,
      });

      expect(trusted.validation).toMatchObject({
        validatorVersion: "sudoku-authored-v1@1",
        publishable: true,
        code: "unique",
      });
      expect(trusted.validation.payloadHash).toMatch(/^[0-9a-f]{64}$/);
      expect(parseGameCoursewarePayload(
        "sudoku",
        "sudoku-authored-v1",
        trusted.payload,
      )).toEqual(trusted.payload);
      expect(gamePageDocSchema.parse({
        docVersion: "game-page-v1",
        canvas: { width: 960, height: 720, backgroundColor: "#ffffff" },
        gameId: "sudoku",
        contentVersion: "sudoku-authored-v1",
        payload: trusted.payload,
        validation: trusted.validation,
      }).payload).toEqual(trusted.payload);
    });
  }

  it("allows an incomplete draft while marking it non-publishable", () => {
    const payload = createDefaultGameCoursewarePayload("sudoku", "sudoku-authored-v1");
    const trusted = validateGameCoursewareContent("sudoku", "sudoku-authored-v1", payload);
    expect(trusted.validation).toMatchObject({ publishable: false, code: "multiple" });
  });

  it("rejects payload shapes that do not match the registered variant", () => {
    expect(() => parseGameCoursewarePayload("sudoku", "sudoku-authored-v1", {
      kind: "authored",
      variantId: "classic-6x6",
      puzzle: new Array(81).fill(0),
      display,
    })).toThrow();
  });
});

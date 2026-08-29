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
    expect(gameCoursewareContractsForSurface("microcourse")).toEqual([
      expect.objectContaining({ contentVersion: "sudoku-authored-v2" }),
    ]);
    expect(GAME_COURSEWARE_CONTRACTS).toHaveLength(2);
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

  it("publishes a forced teaching target without requiring the whole board to be unique", () => {
    const puzzle = [
      1, 2, 3, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ];
    const trusted = validateGameCoursewareContent("sudoku", "sudoku-authored-v2", {
      kind: "authored-activity",
      variantId: "classic-4x4",
      puzzle,
      goal: { kind: "teaching-target", targets: [{ kind: "cell-value", index: 3, value: 4 }] },
      display,
    });

    expect(trusted.validation).toMatchObject({
      validatorVersion: "sudoku-authored-v2@1",
      publishable: true,
      code: "teaching-target-ready",
    });
    expect(trusted.validation.details).toMatchObject({
      puzzle: { status: "multiple" },
      targets: [{ index: 3, value: 4, status: "forced" }],
    });
  });

  it("keeps full-solution unique while allowing solvable teacher-led boards", () => {
    const blank = new Array(16).fill(0);
    const teacherLed = validateGameCoursewareContent("sudoku", "sudoku-authored-v2", {
      kind: "authored-activity",
      variantId: "classic-4x4",
      puzzle: blank,
      goal: { kind: "teacher-led" },
      display,
    });
    const fullSolution = validateGameCoursewareContent("sudoku", "sudoku-authored-v2", {
      kind: "authored-activity",
      variantId: "classic-4x4",
      puzzle: blank,
      goal: { kind: "full-solution", requireUnique: true },
      display,
    });
    const unforcedTarget = validateGameCoursewareContent("sudoku", "sudoku-authored-v2", {
      kind: "authored-activity",
      variantId: "classic-4x4",
      puzzle: blank,
      goal: { kind: "teaching-target", targets: [{ kind: "cell-value", index: 0, value: 1 }] },
      display,
    });

    expect(teacherLed.validation).toMatchObject({ publishable: true, code: "teacher-led-ready" });
    expect(fullSolution.validation).toMatchObject({ publishable: false, code: "full-solution-multiple" });
    expect(unforcedTarget.validation).toMatchObject({ publishable: false, code: "teaching-target-not-forced" });
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

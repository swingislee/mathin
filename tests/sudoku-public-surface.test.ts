import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("public Sudoku surface", () => {
  it("provides a definite 4:3 host and excludes classroom-only affordances", () => {
    const adapter = readFileSync(
      new URL("../src/features/games/boards.tsx", import.meta.url),
      "utf8",
    );

    expect(adapter).toContain('className="mx-auto aspect-[4/3] w-full"');
    expect(adapter).toContain("allowAnswerReveal={false}");
    expect(adapter).toContain("showCoordinates={false}");
    expect(adapter).toContain("showTeachingTools={false}");
  });

  it("uses explicit candidate-note and value-entry symbols", () => {
    const board = readFileSync(
      new URL("../src/features/games/sudoku/SudokuBoard.tsx", import.meta.url),
      "utf8",
    );

    expect(board).toContain("function CandidateNotesIcon");
    expect(board).toMatch(/>2<\/text>[\s\S]*>4<\/text>[\s\S]*>7<\/text>/u);
    expect(board).toContain("<Hand aria-hidden");
  });
});

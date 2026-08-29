import { describe, expect, it } from "vitest";
import { gamePageDocSchema } from "@/features/courseware-doc/game-page-schema";
import {
  addGamePageGridBlock,
  applyGamePageGridTemplate,
  defaultGamePageGridLayout,
  gamePageGridLayoutSchema,
  removeGamePageGridBlock,
  updateGamePageGridPlacement,
} from "@/features/games/courseware/game-page-layout";

describe("game page 12x9 composition grid", () => {
  it("keeps legacy full-page game docs valid while resolving a full grid", () => {
    const doc = gamePageDocSchema.parse({
      docVersion: "game-page-v1",
      canvas: { width: 960, height: 720, backgroundColor: "#ffffff" },
      gameId: "sudoku",
      contentVersion: "sudoku-authored-v2",
      payload: {
        kind: "authored-activity",
        variantId: "classic-4x4",
        puzzle: new Array(16).fill(0),
        goal: { kind: "teacher-led" },
        display: {
          showCoordinates: true,
          allowCandidates: true,
          allowAnswerReveal: false,
          showTeachingTools: true,
        },
      },
      validation: {
        payloadHash: "a".repeat(64),
        validatorVersion: "sudoku-authored-v2@1",
        publishable: true,
        code: "teacher-led-ready",
        details: {},
      },
    });

    expect(doc.layout).toBeUndefined();
    expect(defaultGamePageGridLayout().blocks[0].placement).toEqual({
      column: 0,
      row: 0,
      columnSpan: 12,
      rowSpan: 9,
    });
  });

  it("applies constrained left/right and top/bottom templates without coordinates in authoring", () => {
    const left = applyGamePageGridTemplate(defaultGamePageGridLayout(), "text-left");
    expect(left.blocks).toMatchObject([
      { type: "game", placement: { column: 4, row: 0, columnSpan: 8, rowSpan: 9 } },
      { type: "text", placement: { column: 0, row: 0, columnSpan: 4, rowSpan: 9 } },
    ]);
    const bottom = applyGamePageGridTemplate(left, "text-bottom");
    expect(bottom.blocks).toMatchObject([
      { type: "game", placement: { column: 0, row: 0, columnSpan: 12, rowSpan: 6 } },
      { type: "text", placement: { column: 0, row: 6, columnSpan: 12, rowSpan: 3 } },
    ]);
  });

  it("adds, redistributes, moves, and removes companion blocks without overlap", () => {
    const withText = applyGamePageGridTemplate(defaultGamePageGridLayout(), "text-left");
    const withImage = addGamePageGridBlock(withText, {
      id: "image-1",
      type: "image",
      bindingKey: "b".repeat(64),
      alt: "diagram",
      fit: "contain",
      placement: { column: 0, row: 0, columnSpan: 4, rowSpan: 4 },
    });
    expect(gamePageGridLayoutSchema.safeParse(withImage).success).toBe(true);
    expect(withImage.blocks.filter((block) => block.type !== "game").map((block) => block.placement.rowSpan)).toEqual([5, 4]);

    const rejectedOverlap = updateGamePageGridPlacement(
      withImage,
      "image-1",
      { column: 4, row: 0, columnSpan: 4, rowSpan: 4 },
    );
    expect(rejectedOverlap).toEqual(withImage);

    const removed = removeGamePageGridBlock(withImage, "text-1");
    expect(removed.blocks.map((block) => block.id)).toEqual(["game", "image-1"]);
    expect(gamePageGridLayoutSchema.safeParse(removed).success).toBe(true);
  });

  it("lets a companion swap sides with the game instead of rejecting the collision", () => {
    const left = applyGamePageGridTemplate(defaultGamePageGridLayout(), "text-left");
    const right = updateGamePageGridPlacement(
      left,
      "text-1",
      { column: 8, row: 0, columnSpan: 4, rowSpan: 9 },
    );

    expect(right.blocks).toMatchObject([
      { id: "game", placement: { column: 0, row: 0, columnSpan: 8, rowSpan: 9 } },
      { id: "text-1", placement: { column: 8, row: 0, columnSpan: 4, rowSpan: 9 } },
    ]);
    expect(gamePageGridLayoutSchema.safeParse(right).success).toBe(true);
  });

  it("turns a side companion into a full row and resizes the game into the remaining area", () => {
    const left = applyGamePageGridTemplate(defaultGamePageGridLayout(), "text-left");
    const bottom = updateGamePageGridPlacement(
      left,
      "text-1",
      { column: 0, row: 6, columnSpan: 12, rowSpan: 3 },
    );

    expect(bottom.blocks).toMatchObject([
      { id: "game", placement: { column: 0, row: 0, columnSpan: 12, rowSpan: 6 } },
      { id: "text-1", placement: { column: 0, row: 6, columnSpan: 12, rowSpan: 3 } },
    ]);
    expect(gamePageGridLayoutSchema.safeParse(bottom).success).toBe(true);
  });

  it("reorders companion tiles when one is dragged into another tile's slot", () => {
    const withText = applyGamePageGridTemplate(defaultGamePageGridLayout(), "text-left");
    const withImage = addGamePageGridBlock(withText, {
      id: "image-1",
      type: "image",
      bindingKey: "c".repeat(64),
      alt: "diagram",
      fit: "contain",
      placement: { column: 0, row: 0, columnSpan: 4, rowSpan: 4 },
    });
    const reordered = updateGamePageGridPlacement(
      withImage,
      "image-1",
      { column: 0, row: 0, columnSpan: 4, rowSpan: 4 },
    );
    const image = reordered.blocks.find((block) => block.id === "image-1");
    const text = reordered.blocks.find((block) => block.id === "text-1");

    expect(image?.placement.row).toBe(0);
    expect(text?.placement.row).toBeGreaterThanOrEqual(4);
    expect(gamePageGridLayoutSchema.safeParse(reordered).success).toBe(true);
  });

  it("rejects overlaps and unusably small classroom game regions", () => {
    expect(gamePageGridLayoutSchema.safeParse({
      ...defaultGamePageGridLayout(),
      blocks: [
        { id: "game", type: "game", placement: { column: 0, row: 0, columnSpan: 7, rowSpan: 9 } },
        { id: "text-1", type: "text", text: "x", align: "left", placement: { column: 6, row: 0, columnSpan: 6, rowSpan: 9 } },
      ],
    }).success).toBe(false);
  });
});

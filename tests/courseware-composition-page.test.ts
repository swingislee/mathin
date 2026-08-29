import { describe, expect, it } from "vitest";
import {
  addCoursewareCompositionGame,
  addCoursewareCompositionH5,
  addCoursewareCompositionNode,
  removeCoursewareCompositionBlock,
  updateCoursewareCompositionPlacement,
} from "@/features/courseware-doc/composition-page-layout";
import {
  coursewareCompositionPageSchema,
  createEmptyCoursewareCompositionPage,
} from "@/features/courseware-doc/composition-page-schema";
import type { GamePageDoc } from "@/features/courseware-doc/game-page-schema";
import type { DocNode } from "@/features/courseware-doc/schema";

function textNode(id: string): DocNode {
  return {
    id,
    nodePath: id,
    sourceType: "teacher-text",
    sourceResourceId: null,
    adapter: "teacher-composition-v1",
    name: "课堂文字",
    supported: true,
    visible: true,
    interactive: false,
    zIndex: 1,
    order: 1,
    crop: null,
    transform: {
      x: 0,
      y: 0,
      width: 320,
      height: 720,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      anchorX: 0,
      anchorY: 0,
      opacity: 1,
      flipX: false,
      flipY: false,
      clip: true,
    },
    style: {
      objectFit: "contain",
      backgroundColor: null,
      color: "#2d2a26",
      borderColor: null,
      borderWidth: 0,
      borderRadius: 0,
      fontFamily: null,
      fontSize: 28,
      fontWeight: 400,
      lineHeight: 1.4,
      letterSpacing: 0,
      whiteSpace: "pre-wrap",
      textAlign: "left",
      overflow: "hidden",
    },
    content: { kind: "text", text: "课堂提示" },
    resources: [],
    children: [],
  };
}

function sudokuGame(): GamePageDoc {
  return {
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
  };
}

const h5 = {
  artifactId: "00000000-0000-4000-8000-000000000001",
  sha256: "b".repeat(64),
  byteCount: 1_024,
  entryPath: "index.html" as const,
};

describe("courseware composition page", () => {
  it("requires every foreground node to occupy exactly one grid tile", () => {
    const empty = createEmptyCoursewareCompositionPage();
    const orphan = structuredClone(empty);
    orphan.overlay.nodes.push(textNode("orphan-1"));

    expect(coursewareCompositionPageSchema.safeParse(empty).success).toBe(true);
    expect(coursewareCompositionPageSchema.safeParse(orphan).success).toBe(false);
  });

  it("adds and removes a foreground node while keeping its transform snapped to 12x9 cells", () => {
    const withText = addCoursewareCompositionNode(
      createEmptyCoursewareCompositionPage(),
      textNode("text-1"),
      { columnSpan: 4, rowSpan: 9 },
    );

    expect(withText.layout.blocks[0]).toMatchObject({
      id: "node-text-1",
      type: "node",
      placement: { column: 0, row: 0, columnSpan: 4, rowSpan: 9 },
    });
    expect(withText.overlay.nodes[0].transform).toMatchObject({ x: 0, y: 0, width: 320, height: 720 });
    expect(coursewareCompositionPageSchema.safeParse(withText).success).toBe(true);

    const removed = removeCoursewareCompositionBlock(withText, "node-text-1");
    expect(removed.layout.blocks).toHaveLength(0);
    expect(removed.overlay.nodes).toHaveLength(0);
  });

  it("lets an H5 tile swap sides with text and resize without overlap", () => {
    const withText = addCoursewareCompositionNode(
      createEmptyCoursewareCompositionPage(),
      textNode("text-1"),
      { columnSpan: 4, rowSpan: 9 },
    );
    const withH5 = addCoursewareCompositionH5(withText, h5);
    const swapped = updateCoursewareCompositionPlacement(
      withH5,
      "node-text-1",
      { column: 8, row: 0, columnSpan: 4, rowSpan: 9 },
    );

    expect(swapped.layout.blocks).toMatchObject([
      { id: "node-text-1", placement: { column: 8, row: 0, columnSpan: 4, rowSpan: 9 } },
      { id: "interactive-h5", placement: { column: 0, row: 0, columnSpan: 8, rowSpan: 9 } },
    ]);
    expect(coursewareCompositionPageSchema.safeParse(swapped).success).toBe(true);

    const fullWidthH5 = updateCoursewareCompositionPlacement(
      addCoursewareCompositionH5(createEmptyCoursewareCompositionPage(), h5),
      "interactive-h5",
      { column: 0, row: 0, columnSpan: 12, rowSpan: 6 },
    );
    expect(fullWidthH5.layout.blocks[0].placement).toEqual({
      column: 0,
      row: 0,
      columnSpan: 12,
      rowSpan: 6,
    });
  });

  it("permits only one authoritative game or H5 component", () => {
    const withGame = addCoursewareCompositionGame(createEmptyCoursewareCompositionPage(), sudokuGame());
    const rejectedH5 = addCoursewareCompositionH5(withGame, h5);

    expect(withGame.layout.blocks).toHaveLength(1);
    expect(rejectedH5).toEqual(withGame);
    expect(coursewareCompositionPageSchema.safeParse(withGame).success).toBe(true);
  });
});

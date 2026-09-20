import { afterEach, describe, expect, it, vi } from "vitest";
import { isBoardColor, normalizeHexColor } from "@/features/whiteboard/board-color";
import { boardColorSchema } from "@/features/whiteboard/board-color-schema";
import { colorVar, resolveColor } from "@/features/whiteboard/strokes";
import { COLOR_TOKENS, type ShapeItem, type StrokeItem } from "@/features/whiteboard/types";
import { createWhiteboardStore } from "@/features/whiteboard/store";
import { ProgressStreamAssembler } from "@/features/whiteboard/progress-stream";
import { buildBoardCheckpoint } from "@/features/classroom/checkpoint/codec";
import { flattenCheckpointChunks, parseBoardItems } from "@/features/classroom/checkpoint/parse";
import { annotationContentSchema } from "@/features/school/teacher-preparation-contract";
import { parseSolutionBoardItems } from "@/features/school/solution-board-items";

const stroke: StrokeItem = {
  id: "11111111-1111-4111-8111-111111111111", mode: "ink", color: "#4169e1", wNorm: 0.003,
  brush: "freehand-v3", points: [[0.1, 0.2], [0.3, 0.4]], samples: [[0, null], [8, 0.7]],
};
const shape: ShapeItem = {
  id: "11111111-1111-4111-8111-111111111112", kind: "shape", shape: "rectangle", color: "#AABBCC", fill: "#ffffff",
  strokeWidthNorm: 0.003, x: 0.5, y: 0.5, width: 0.3, height: 0.2, rotation: 0,
};

afterEach(() => vi.unstubAllGlobals());

describe("custom whiteboard colors", () => {
  it("accepts semantic colors and six-digit HEX, normalizing only user input", () => {
    for (const color of [...COLOR_TOKENS, "#000000", "#ffffff", "#A0b1C2"]) {
      expect(isBoardColor(color)).toBe(true);
      expect(boardColorSchema.parse(color)).toBe(color);
    }
    expect(normalizeHexColor(" #Fa3 ")).toBe("#ffaa33");
    expect(normalizeHexColor("#A0B1C2")).toBe("#a0b1c2");
  });

  it.each(["#000", "#12345g", "#12345678", "#123456\n", "red", "rgb(1,2,3)", "url(https://example.com)", "var(--ink)", "", null, 123])(
    "rejects invalid persisted colors %s at every shared boundary", (color) => {
      expect(isBoardColor(color)).toBe(false);
      expect(boardColorSchema.safeParse(color).success).toBe(false);
      for (const item of [{ ...stroke, color }, { ...shape, color }, ...(color === null ? [] : [{ ...shape, fill: color }])]) {
        expect(() => parseBoardItems([item])).toThrow("CHECKPOINT_ITEMS_INVALID");
        expect(annotationContentSchema.safeParse([item]).success).toBe(false);
      }
    },
  );

  it("keeps custom colors and pressure across checkpoints, archives and progress", () => {
    const items = [stroke, shape];
    const checkpoint = buildBoardCheckpoint(items);
    const saved = flattenCheckpointChunks(JSON.parse(JSON.stringify(checkpoint.chunks)), items.length);
    expect(saved).toEqual(items);
    expect(annotationContentSchema.parse(saved)).toEqual(items);
    expect(parseSolutionBoardItems(saved)).toEqual(items);
    const stream = new ProgressStreamAssembler();
    stream.ingest({ ...stroke, seq: 0 }, false);
    expect([...stream.strokes()]).toEqual([stroke]);
  });

  it("broadcasts selected object recoloring and restores original colors on undo", () => {
    const board = createWhiteboardStore();
    board.getState().hydrate("test", [stroke, shape]);
    board.getState().setSelectedIds([stroke.id, shape.id]);
    board.getState().styleSelected({ color: "#ff8800", fill: "#113355" });
    const receiver = createWhiteboardStore();
    receiver.getState().hydrate("test", [stroke, shape]);
    for (const op of board.getState().drainOutbox()) receiver.getState().applyRemote(op);
    expect(receiver.getState().items).toEqual(board.getState().items);
    expect(receiver.getState().items[0].color).toBe("#ff8800");
    expect(receiver.getState().items[1]).toMatchObject({ color: "#ff8800", fill: "#113355" });
    board.getState().undo();
    expect(board.getState().items).toEqual([stroke, shape]);
  });

  it("renders custom colors literally in canvas/export and SVG while retaining themed presets", () => {
    const getPropertyValue = vi.fn(() => " #e55c60 ");
    const computed = vi.fn(() => ({ getPropertyValue }));
    vi.stubGlobal("getComputedStyle", computed);
    const element = {} as Element;
    expect(resolveColor(element, "#4169e1")).toBe("#4169e1");
    expect(colorVar("#ffffff")).toBe("#ffffff");
    expect(computed).not.toHaveBeenCalled();
    expect(resolveColor(element, "rose")).toBe("#e55c60");
    expect(getPropertyValue).toHaveBeenCalledWith("--rose");
    expect(colorVar("blue")).toBe("var(--blue)");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fitFormulaPadBounds } from "../src/features/whiteboard/FormulaInkPad";
import { createWhiteboardStore } from "../src/features/whiteboard/store";
import type { FormulaItem, StrokeItem } from "../src/features/whiteboard/types";

const stroke: StrokeItem = {
  id: "ink-1",
  mode: "ink",
  color: "ink",
  wNorm: 0.006,
  points: [[0.2, 0.3], [0.3, 0.4]],
};

const formula: FormulaItem = {
  id: "formula-1",
  kind: "formula",
  latex: "x^2",
  color: "ink",
  x: 0.25,
  y: 0.35,
  width: 0.2,
  height: 0.1,
  rotation: 0,
};

describe("Word-style formula handwriting area", () => {
  it("keeps the handwriting area usable and inside the board", () => {
    const bounds = fitFormulaPadBounds(
      { x: 0.95, y: 0.92, width: 0.01, height: 0.01 },
      1000,
      600,
    );
    expect(bounds.x).toBeCloseTo(0.72);
    expect(bounds.y).toBeCloseTo(0.7333333333);
    expect(bounds.width).toBeCloseTo(0.28);
    expect(bounds.height).toBeCloseTo(0.2666666667);
  });

  it("publishes only the confirmed formula and restores the original ink on undo", () => {
    const store = createWhiteboardStore();
    store.getState().commitFormulaFromInk([stroke], formula);

    expect(store.getState().items).toEqual([formula]);
    expect(store.getState().drainOutbox()).toEqual([{ t: "commit", item: formula }]);

    store.getState().undo();
    expect(store.getState().items).toEqual([stroke]);
    expect(store.getState().drainOutbox()).toEqual([
      { t: "erase", id: formula.id },
      { t: "restore", items: [stroke] },
    ]);
  });

  it("keeps handwriting as one undoable action when recognition is skipped", () => {
    const store = createWhiteboardStore();
    store.getState().commitItems([stroke, { ...stroke, id: "ink-2" }]);
    expect(store.getState().items).toHaveLength(2);

    store.getState().undo();
    expect(store.getState().items).toEqual([]);
  });

  it("renders original ink beside the editable recognition result", () => {
    const dialog = readFileSync(
      "src/features/whiteboard/FormulaRecognitionDialog.tsx",
      "utf8",
    );
    const surface = readFileSync(
      "src/features/whiteboard/CanvasSurface.tsx",
      "utf8",
    );

    expect(dialog).toContain('t("formulaInkOriginal")');
    expect(dialog).toContain("onLatexChange");
    expect(surface).toContain("<FormulaInkPad");
    expect(surface).toContain("commitFormulaFromInk");
    expect(surface).not.toContain("inkStrokesInRect");
  });
});

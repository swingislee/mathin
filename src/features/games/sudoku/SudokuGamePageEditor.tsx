"use client";

import type { GamePageDoc } from "@/features/courseware-doc/game-page-schema";
import { analyzeSudokuPuzzle } from "./logic";
import { sudokuAuthoredPayloadSchema } from "./courseware-contract";
import { SudokuPuzzleEditor } from "./SudokuPuzzleEditor";

export function SudokuGamePageEditor({
  doc,
  onChange,
}: {
  doc: GamePageDoc;
  onChange: (doc: GamePageDoc) => void;
}) {
  const payload = sudokuAuthoredPayloadSchema.parse(doc.payload);
  return (
    <SudokuPuzzleEditor
      payload={payload}
      onChange={(nextPayload) => {
        const analysis = analyzeSudokuPuzzle(nextPayload.puzzle, nextPayload.variantId);
        onChange({
          ...doc,
          payload: nextPayload,
          validation: {
            ...doc.validation,
            publishable: analysis.status === "unique",
            code: analysis.status,
            details: analysis,
          },
        });
      }}
    />
  );
}


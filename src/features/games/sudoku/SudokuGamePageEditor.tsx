"use client";

import type { GamePageDoc } from "@/features/courseware-doc/game-page-schema";
import { analyzeSudokuCoursewareActivity } from "./activity";
import { analyzeSudokuPuzzle } from "./logic";
import {
  sudokuActivityPayloadSchema,
  sudokuAuthoredPayloadSchema,
  type SudokuCoursewarePayload,
} from "./courseware-contract";
import { SudokuPuzzleEditor } from "./SudokuPuzzleEditor";

export function SudokuGamePageEditor({
  doc,
  onChange,
}: {
  doc: GamePageDoc;
  onChange: (doc: GamePageDoc) => void;
}) {
  const payload: SudokuCoursewarePayload = doc.contentVersion === "sudoku-authored-v2"
    ? sudokuActivityPayloadSchema.parse(doc.payload)
    : sudokuAuthoredPayloadSchema.parse(doc.payload);
  return (
    <SudokuPuzzleEditor
      payload={payload}
      onChange={(nextPayload) => {
        const activity = analyzeSudokuCoursewareActivity(nextPayload);
        const legacy = nextPayload.kind === "authored"
          ? analyzeSudokuPuzzle(nextPayload.puzzle, nextPayload.variantId)
          : null;
        onChange({
          ...doc,
          payload: nextPayload,
          validation: {
            ...doc.validation,
            publishable: legacy ? legacy.status === "unique" : activity.ready,
            code: legacy?.status ?? activity.code,
            details: legacy ?? activity,
          },
        });
      }}
    />
  );
}

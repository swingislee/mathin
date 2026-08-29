"use client";

import type { GamePageDoc } from "@/features/courseware-doc/game-page-schema";
import type { GameMirrorState } from "../types";
import { analyzeSudokuCoursewareActivity } from "./activity";
import {
  sudokuActivityPayloadSchema,
  sudokuAuthoredPayloadSchema,
  type SudokuCoursewarePayload,
} from "./courseware-contract";
import { SudokuBoard } from "./SudokuBoard";

export function SudokuGamePageStage({
  doc,
  interactive,
  mirror,
  onMirror,
  compact,
}: {
  doc: GamePageDoc;
  interactive?: boolean;
  mirror?: GameMirrorState | null;
  onMirror?: (state: GameMirrorState) => void;
  compact?: boolean;
}) {
  const payload: SudokuCoursewarePayload = doc.contentVersion === "sudoku-authored-v2"
    ? sudokuActivityPayloadSchema.parse(doc.payload)
    : sudokuAuthoredPayloadSchema.parse(doc.payload);
  const activity = analyzeSudokuCoursewareActivity(payload);
  const hasAnswers = activity.answerValues.some((value) => value > 0);
  return (
    <div className={compact ? "size-full overflow-hidden p-1" : "size-full overflow-auto p-3 sm:p-5"}>
      <SudokuBoard
        seed={`game-page:${payload.variantId}:${doc.validation.code}`}
        difficulty="medium"
        puzzle={payload.puzzle}
        variantId={payload.variantId}
        showCoordinates={payload.display.showCoordinates}
        allowCandidates={payload.display.allowCandidates}
        allowAnswerReveal={payload.display.allowAnswerReveal && hasAnswers}
        showTeachingTools={payload.display.showTeachingTools}
        answerValues={activity.answerValues}
        completionTargets={activity.completionTargets}
        finished={false}
        onComplete={() => undefined}
        mirror={mirror}
        onMirror={onMirror}
        readOnly={!interactive}
      />
    </div>
  );
}

"use client";

import type { GamePageDoc } from "@/features/courseware-doc/game-page-schema";
import { sudokuAuthoredPayloadSchema } from "./courseware-contract";
import { SudokuBoard } from "./SudokuBoard";

export function SudokuGamePageStage({
  doc,
  interactive,
}: {
  doc: GamePageDoc;
  interactive?: boolean;
}) {
  const payload = sudokuAuthoredPayloadSchema.parse(doc.payload);
  return (
    <div className="size-full overflow-auto p-3 sm:p-5">
      <SudokuBoard
        seed={`game-page:${payload.variantId}:${doc.validation.code}`}
        difficulty="medium"
        puzzle={payload.puzzle}
        variantId={payload.variantId}
        showCoordinates={payload.display.showCoordinates}
        allowCandidates={payload.display.allowCandidates}
        allowAnswerReveal={payload.display.allowAnswerReveal}
        showTeachingTools={payload.display.showTeachingTools}
        finished={false}
        onComplete={() => undefined}
        readOnly={!interactive}
      />
    </div>
  );
}


"use client";

import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import type { GamePageDoc } from "@/features/courseware-doc/game-page-schema";

const SudokuGamePageStage = dynamic(
  () => import("../sudoku/SudokuGamePageStage").then((module) => module.SudokuGamePageStage),
  { ssr: false },
);

export interface GamePageStageProps {
  doc: GamePageDoc;
  className?: string;
  interactive?: boolean;
}

export default function GamePageStage({ doc, className, interactive }: GamePageStageProps) {
  return (
    <div
      className={cn("relative aspect-[4/3] w-full overflow-hidden bg-white", className)}
      data-game-page={doc.gameId}
      data-game-content-version={doc.contentVersion}
      data-classroom-input="native"
    >
      {doc.gameId === "sudoku" && doc.contentVersion === "sudoku-authored-v1"
        ? <SudokuGamePageStage doc={doc} interactive={interactive} />
        : null}
    </div>
  );
}


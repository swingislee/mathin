"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import type { GamePageDoc } from "@/features/courseware-doc/game-page-schema";

const SudokuGamePageEditor = dynamic(
  () => import("../sudoku/SudokuGamePageEditor").then((module) => module.SudokuGamePageEditor),
  { loading: () => <Skeleton className="h-80 w-full rounded-xl" /> },
);

export function GamePageEditor({
  doc,
  onChange,
}: {
  doc: GamePageDoc;
  onChange: (doc: GamePageDoc) => void;
}) {
  const t = useTranslations("teacherMicrocourses");
  switch (`${doc.gameId}:${doc.contentVersion}`) {
    case "sudoku:sudoku-authored-v1":
    case "sudoku:sudoku-authored-v2":
      return <SudokuGamePageEditor doc={doc} onChange={onChange} />;
    default:
      return <p className="text-sm text-rose">{t("unsupportedGamePage")}</p>;
  }
}

import { Hash, Sigma, WandSparkles } from "lucide-react";
import { verifyKakuro } from "./kakuro/logic";
import { KakuroBoard } from "./kakuro/KakuroBoard";
import { verifyMagic } from "./magic-square/logic";
import { MagicSquareBoard } from "./magic-square/MagicSquareBoard";
import { verifySudoku } from "./sudoku/logic";
import { SudokuBoard } from "./sudoku/SudokuBoard";
import type { GameDef } from "./types";

// 新增游戏 = 加一个 feature 目录 + 这里一行注册，不改路由代码（docs/plan/03-2）
export const games: GameDef[] = [
  { id: "sudoku", no: 1, crowns: 2, icon: Hash, difficulties: ["easy", "medium", "hard"], Board: SudokuBoard, verify: verifySudoku },
  { id: "kakuro", no: 2, crowns: 3, icon: Sigma, difficulties: ["easy", "medium", "hard"], Board: KakuroBoard, verify: verifyKakuro },
  { id: "magic-square", no: 3, crowns: 1, icon: WandSparkles, difficulties: ["easy", "medium", "hard"], Board: MagicSquareBoard, verify: verifyMagic },
];

export function getGame(id: string): GameDef | undefined {
  return games.find((g) => g.id === id);
}

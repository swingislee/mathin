import { Hash } from "lucide-react";
import { verifySudoku } from "./sudoku/logic";
import { SudokuBoard } from "./sudoku/SudokuBoard";
import type { GameDef } from "./types";

// 新增游戏 = 加一个 feature 目录 + 这里一行注册，不改路由代码（docs/plan/03-2）
export const games: GameDef[] = [
  { id: "sudoku", no: 1, crowns: 2, icon: Hash, difficulties: ["easy", "medium", "hard"], Board: SudokuBoard, verify: verifySudoku },
];

export function getGame(id: string): GameDef | undefined {
  return games.find((g) => g.id === id);
}

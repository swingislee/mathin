import { Hash, Sigma, WandSparkles } from "lucide-react";
import type { GameMeta } from "./types";

// 新增游戏 = 加一个 feature 目录 + 这里一行注册，再在 ./boards 与 ./verify 各挂一行（docs/plan/03-2）。
// 本文件只留元数据，必须保持「零组件、零逻辑」——它被 dashboard、课件编辑器、sitemap 引用，
// 一旦把 Board/verify 焊回来，那些页面又会白背整个游戏实现（P4G-7 §6.1）。
export const games: GameMeta[] = [
  { id: "sudoku", no: 1, crowns: 2, icon: Hash, difficulties: ["easy", "medium", "hard"] },
  { id: "kakuro", no: 2, crowns: 3, icon: Sigma, difficulties: ["easy", "medium", "hard"] },
  { id: "magic-square", no: 3, crowns: 1, icon: WandSparkles, difficulties: ["easy", "medium", "hard"] },
];

export function getGame(id: string): GameMeta | undefined {
  return games.find((g) => g.id === id);
}

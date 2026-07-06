import type { GameDef } from "./types";

// 新增游戏 = 加一个 feature 目录 + 这里一行注册，不改路由代码（docs/plan/03-2）
export const games: GameDef[] = [];

export function getGame(id: string): GameDef | undefined {
  return games.find((g) => g.id === id);
}

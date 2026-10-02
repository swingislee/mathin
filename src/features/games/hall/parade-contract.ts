import type { ReactNode } from "react";
import type { Difficulty, GameSuit } from "../types";

export const GAME_SUIT_GLYPH: Record<GameSuit, string> = {
  spade: "♠",
  heart: "♥",
  diamond: "♦",
  club: "♣",
};

/** 牌背上的单个难度战绩；best 为已格式化的最佳用时，未通关为 null。 */
export interface GameParadeRecord {
  difficulty: Difficulty;
  label: string;
  best: string | null;
}

/** 一张游戏牌的全部展示数据，由服务端翻译和读取成绩后传给牌阵。 */
export interface GameParadeCard {
  id: string;
  no: number;
  suit: GameSuit;
  suitLabel: string;
  crowns: number;
  icon: ReactNode;
  name: string;
  desc: string;
  position: string;
  records: GameParadeRecord[];
}

export interface GameParadeLabels {
  region: string;
  slide: string;
  prev: string;
  next: string;
  flip: string;
  flipBack: string;
  records: string;
  noRecord: string;
  start: string;
  ranks: string;
  difficultyLabel: string;
  loginToRank: string;
}

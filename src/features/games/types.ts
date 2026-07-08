import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

export type Difficulty = "easy" | "medium" | "hard";

/**
 * 课堂镜像轻状态（08-§3.6 game_state）：三个游戏共用同一形状——
 * 盘面数值数组 + 当前选中格。题面本身由 seed 推导，无需入镜像。
 */
export interface GameMirrorState {
  values: number[];
  selected: number | null;
}

export interface GameBoardProps {
  /** 题目种子，题面由各游戏用 createRng(seed) 确定性推导（服务端校验时同样推导） */
  seed: string;
  difficulty: Difficulty;
  /** 完赛后棋盘进入只读态 */
  finished: boolean;
  /** 玩家完成时上报完整解，服务端用 GameDef.verify 复核 */
  onComplete: (proof: unknown) => void;
  /** 课堂镜像（可选）：新对象到达即覆盖本地盘面（跟随端应用教师状态） */
  mirror?: GameMirrorState | null;
  /** 课堂镜像（可选）：本地每次操作后上报全量轻状态（主控端=单写者） */
  onMirror?: (state: GameMirrorState) => void;
  /** 跟随端只读：不响应任何输入（大屏/学生端） */
  readOnly?: boolean;
}

export interface GameDef {
  /** 路由段（kebab-case），同时是 messages 里 games.items 的 key */
  id: string;
  /** 图鉴编号 */
  no: number;
  /** 游戏整体难度星级 1–3（国王星球用王冠呈现） */
  crowns: 1 | 2 | 3;
  icon: LucideIcon;
  difficulties: readonly Difficulty[];
  Board: ComponentType<GameBoardProps>;
  /** 纯函数：由 seed+难度重新生成题目并检验 proof 是否为其有效解（服务端调用） */
  verify: (seed: string, difficulty: Difficulty, proof: unknown) => boolean;
}

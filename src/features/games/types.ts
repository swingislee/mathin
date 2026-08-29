import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import type { ClassroomInputCapabilityProvider } from "@/features/classroom/input/provider";

export type Difficulty = "easy" | "medium" | "hard";

export type SudokuHighlightTool = "cell" | "box" | "row" | "column" | "digit";

export interface SudokuCellHighlightRegion {
  /** 0–(N-1)，均为规范化后的闭区间边界。 */
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface SudokuTeachingHighlights {
  /** 0–(N-1)：宫编号，按从左到右、从上到下排列。 */
  boxes: number[];
  /** 0–(N-1)：整行。 */
  rows: number[];
  /** 0–(N-1)：整列。 */
  columns: number[];
  /** 可叠加的任意轴对齐单元格矩形；单击等价于 1×1 矩形。 */
  regions: SudokuCellHighlightRegion[];
  /** 与正常 inputDigit 完全独立；null 表示不突出任何数字。 */
  focusedDigit: number | null;
}

export interface SudokuInvalidAttempt {
  /** 被拒绝的格子，0–(N²-1)、行优先。 */
  index: number;
  /** 被拒绝的数字，1–N。 */
  digit: number;
  /** 单调递增事件号；课堂跟随端据此只播放一次瞬时反馈。 */
  sequence: number;
}

/**
 * 课堂镜像轻状态（08-§3.6 game_state）：三个游戏共用 values + selected；
 * 数独附带候选、输入、M3 讲解突出和 M4 错误事件。题型与题面仍由 seed 推导，无需入镜像。
 */
export interface GameMirrorState {
  values: number[];
  selected: number | null;
  /** 数独专用：每格用 bit 1–N 表示候选数；其他游戏省略。 */
  candidates?: number[];
  /** 数独专用：正常输入数字，不等同于 M3 的可选突出数字。 */
  inputDigit?: number | null;
  /** 数独专用：候选/填数切换。 */
  entryMode?: "candidate" | "value";
  /** 数独 M3：当前讲解工具；再次选择同一工具会退出。 */
  highlightTool?: SudokuHighlightTool | null;
  /** 数独 M3：可自由组合的结构/数字突出。 */
  highlights?: SudokuTeachingHighlights;
  /** 数独 M4：最近一次错误填数的瞬时反馈标记；不写入 values。 */
  invalidAttempt?: SudokuInvalidAttempt | null;
  /** Composition pages aggregate independent game instances by stable tile id. */
  instances?: Record<string, GameMirrorState>;
}

export interface GameBoardProps {
  /** 题目种子，题面由各游戏确定性推导；数独稳定 variantId 也编码在此字段中。 */
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

/**
 * 游戏的元数据。**不含 Board 组件、不含 verify 函数**——这三样曾焊在一个 GameDef 里，
 * 结果是任何只想列出游戏名的页面（dashboard 磁贴、课件编辑器、sitemap）都把三个棋盘
 * 打进了首屏 bundle。棋盘走 `./boards` 的按需加载，校验走 `./verify`（仅服务端）。
 */
export interface GameMeta {
  /** 路由段（kebab-case），同时是 messages 里 games.items 的 key */
  id: string;
  /** 图鉴编号 */
  no: number;
  /** 游戏整体难度星级 1–3（国王星球用王冠呈现） */
  crowns: 1 | 2 | 3;
  icon: LucideIcon;
  difficulties: readonly Difficulty[];
  /** Present only when the board implements the versioned classroom input provider contract. */
  classroomInput?: ClassroomInputCapabilityProvider;
}

export type GameBoard = ComponentType<GameBoardProps>;

/** 纯函数：由 seed+难度重新生成题目并检验 proof 是否为其有效解（服务端调用） */
export type GameVerifier = (seed: string, difficulty: Difficulty, proof: unknown) => boolean;

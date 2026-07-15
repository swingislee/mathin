import { verifyKakuro } from "./kakuro/logic";
import { verifyMagic } from "./magic-square/logic";
import { verifySudoku } from "./sudoku/logic";
import type { GameVerifier } from "./types";

// 服务端防作弊层（03-§3.2）：由 seed+难度重推题面，复核玩家上报的终盘。
// 只被 Server Action 调用——不要从客户端组件 import，否则等于把答案校验器发给玩家。
const verifiers: Record<string, GameVerifier> = {
  sudoku: verifySudoku,
  kakuro: verifyKakuro,
  "magic-square": verifyMagic,
};

export function getVerifier(id: string): GameVerifier | undefined {
  return verifiers[id];
}

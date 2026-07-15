import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { GameBoardProps } from "./types";

// 棋盘按需加载：只有真正渲染棋盘的地方（游戏页开局后、课堂 LiveShell 翻到游戏页）才付这份 JS。
// 游戏页开局前停在 idle 态、课件页要教师点开，所以这个懒加载在体感上是免费的。
//
// 写成「模块级常量 + switch」而不是 `Record<string, Component>` 查表：后者会被
// react-hooks/static-components 判成「渲染期创建组件」，前者是静态的。
function BoardSkeleton() {
  return <Skeleton className="mx-auto aspect-square w-full max-w-md" />;
}

const SudokuBoard = dynamic(() => import("./sudoku/SudokuBoard").then((m) => m.SudokuBoard), { loading: BoardSkeleton });
const KakuroBoard = dynamic(() => import("./kakuro/KakuroBoard").then((m) => m.KakuroBoard), { loading: BoardSkeleton });
const MagicSquareBoard = dynamic(() => import("./magic-square/MagicSquareBoard").then((m) => m.MagicSquareBoard), { loading: BoardSkeleton });

/** 按 id 分发棋盘。id 取自 `./registry` 的元数据，未知 id 渲染空。 */
export function GameBoard({ id, ...props }: GameBoardProps & { id: string }) {
  switch (id) {
    case "sudoku":
      return <SudokuBoard {...props} />;
    case "kakuro":
      return <KakuroBoard {...props} />;
    case "magic-square":
      return <MagicSquareBoard {...props} />;
    default:
      return null;
  }
}

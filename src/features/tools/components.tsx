import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { ToolComponentProps } from "./types";

// 工具按需加载：只有真正渲染某个工具的地方（工具页、概念页的内嵌演示、embed、课堂工具窗）才付它的 JS，
// 且只付被点开的那一个——列表页、概念图谱与 sitemap 现在一份工具代码都不下载。
//
// 同 games/boards.tsx：模块级常量 + switch，避免 react-hooks/static-components 把查表当成渲染期建组件。
function ToolSkeleton() {
  return <Skeleton className="h-64 w-full" />;
}

const FractionLine = dynamic(() => import("./fraction-line/FractionLine").then((m) => m.FractionLine), { loading: ToolSkeleton });
const MotionLab = dynamic(() => import("./motion-lab/MotionLab").then((m) => m.MotionLab), { loading: ToolSkeleton });

/** 按 id 分发工具。id 取自 `./registry` 的元数据，未知 id 渲染空。 */
export function ToolView({ id, ...props }: ToolComponentProps & { id: string }) {
  switch (id) {
    case "fraction-line":
      return <FractionLine {...props} />;
    case "motion-lab":
      return <MotionLab {...props} />;
    default:
      return null;
  }
}

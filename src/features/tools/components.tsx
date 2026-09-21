import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { ToolComponentProps } from "./types";
import type { CoursewareCompositionTool } from "@/features/courseware-doc/composition-page-schema";
import { isCubeCoursewareTool } from "./courseware/cube-structures-content";
import type { CoursewareToolRuntime } from "./courseware/tool-classroom";
import { isToolScene } from "./scenes/contract";
import type { ToolScenePageHeader } from "./scenes/ToolSceneLibrary";

// 工具按需加载：只有真正渲染某个工具的地方（工具页、概念页的内嵌演示、embed、课堂工具窗）才付它的 JS，
// 且只付被点开的那一个——列表页、概念图谱与 sitemap 现在一份工具代码都不下载。
//
// 同 games/boards.tsx：模块级常量 + switch，避免 react-hooks/static-components 把查表当成渲染期建组件。
function ToolSkeleton() {
  return <Skeleton className="h-64 w-full" />;
}

const FractionLine = dynamic(() => import("./fraction-line/FractionLine").then((m) => m.FractionLine), { loading: ToolSkeleton });
const MotionLab = dynamic(() => import("./motion-lab/MotionLab").then((m) => m.MotionLab), { loading: ToolSkeleton });
const SpatialLab = dynamic(() => import("./spatial-lab/SpatialLab").then((m) => m.SpatialLab), { loading: ToolSkeleton });
const ProjectionTool = dynamic(() => import("./projection/ProjectionWorkspace").then((m) => m.ProjectionTool), { loading: ToolSkeleton });
const SolidGeometryTool = dynamic(() => import("./solid-geometry/SolidGeometryExplorationWorkspace").then((m) => m.SolidGeometryExplorationWorkspace), { loading: ToolSkeleton });
const CubeNetExplorationTool = dynamic(() => import("./net-teaching/CubeNetExplorationWorkspace").then((m) => m.CubeNetExplorationWorkspace), { loading: ToolSkeleton });
const SolidNetsTool = dynamic(() => import("./solid-nets/SolidNetsCompleteWorkspace").then((m) => m.SolidNetsCompleteWorkspace), { loading: ToolSkeleton });
const SolidCapacityTool = dynamic(() => import("./solid-capacity/SolidCapacityTeachingWorkspace").then((m) => m.SolidCapacityTeachingWorkspace), { loading: ToolSkeleton });
const SolidRevolutionTool = dynamic(() => import("./solid-revolution/SolidRevolutionWorkspace").then((m) => m.SolidRevolutionWorkspace), { loading: ToolSkeleton });
const SomaTool = dynamic(() => import("./soma-cube/SomaWorkspace").then((m) => m.SomaWorkspace), { loading: ToolSkeleton });
export const CubeCoursewarePreview = dynamic(() => import("./courseware/CubeStructuresCourseware").then((m) => m.CubeStructuresCourseware), { loading: ToolSkeleton });
const ToolScenePresentation = dynamic(() => import("./scenes/ToolScenePresentation").then((m) => m.ToolScenePresentation), { loading: ToolSkeleton });
const PreparedToolWorkbench = dynamic(() => import("./scenes/PreparedToolWorkbench").then((m) => m.PreparedToolWorkbench), { loading: ToolSkeleton });

/** 固定课件内容不打开个人工作台，也不读取账号草稿或页面 URL。 */
export function CoursewareToolView({ tool, classroom }: { tool: CoursewareCompositionTool; classroom?: CoursewareToolRuntime }) {
  if (isToolScene(tool)) return <ToolScenePresentation scene={tool} classroom={classroom} />;
  return isCubeCoursewareTool(tool)
    ? <CubeCoursewarePreview payload={tool.payload} />
    : <ToolView id={tool.toolId} embedded />;
}

/** 按 id 分发工具。id 取自 `./registry` 的元数据，未知 id 渲染空。 */
export function ToolView({ id, preparation = false, preparationHeader, ...props }: ToolComponentProps & { id: string; preparation?: boolean; preparationHeader?: ToolScenePageHeader }) {
  if (preparation && id !== "spatial-lab") return <PreparedToolWorkbench id={id} pageHeader={preparationHeader} />;
  switch (id) {
    case "fraction-line":
      return <FractionLine {...props} />;
    case "motion-lab":
      return <MotionLab {...props} />;
    case "spatial-lab":
      return <SpatialLab {...props} />;
    case "cube-structures":
      return <SpatialLab {...props} activity="spatial-lab.cube-structures.v1" />;
    case "cube-net":
      return <CubeNetExplorationTool />;
    case "solid-nets":
      return <SolidNetsTool />;
    case "dice":
      return <SpatialLab {...props} activity="spatial-lab.dice-teaching.v1" />;
    case "projection":
      return <ProjectionTool />;
    case "solid-geometry":
      return <SolidGeometryTool />;
    case "solid-capacity":
      return <SolidCapacityTool />;
    case "solid-revolution":
      return <SolidRevolutionTool />;
    case "soma-cube":
      return <SomaTool />;
    default:
      return null;
  }
}

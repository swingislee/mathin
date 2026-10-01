import { PLANAR_TOOLS } from "../planar-kit/catalog";
import type { ToolMeta } from "../registry";

/** 工具台左侧木格架的四层，自上而下。 */
export const TOOL_SHELVES = ["number", "plane", "solid", "motion"] as const;
export type ToolShelf = (typeof TOOL_SHELVES)[number];

const PLANAR_IDS = new Set<string>(PLANAR_TOOLS.map((tool) => tool.id));

/** 目录分层按教学领域：registry 的 geometry 拆成平面教具与立体空间。 */
export function toolShelf(tool: Pick<ToolMeta, "id" | "category">): ToolShelf {
  if (tool.category === "number") return "number";
  if (tool.category === "geometry") return PLANAR_IDS.has(tool.id) ? "plane" : "solid";
  return "motion";
}

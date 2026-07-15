import type { LucideIcon } from "lucide-react";
import { Route, Ruler } from "lucide-react";

export type ToolCategory = "number" | "geometry" | "motion" | "misc";

/**
 * 工具元数据。**不含 Component**——组件在 `./components` 里按需加载。
 * 本文件被工具列表、概念页、sitemap、课堂 LiveShell 引用；把组件焊回来会让它们全都白背整套工具实现（P4G-7 §6.1）。
 */
export interface ToolMeta {
  /** 路由段（kebab-case），同时是 messages 里 tools.items 的 key */
  id: string;
  /** 图鉴编号（商人星球的 Nº 印花） */
  no: number;
  category: ToolCategory;
  /** 适用年级区间 */
  grades: [number, number];
  icon: LucideIcon;
}

export const tools: ToolMeta[] = [
  { id: "fraction-line", no: 1, category: "number", grades: [3, 6], icon: Ruler },
  { id: "motion-lab", no: 2, category: "motion", grades: [4, 6], icon: Route },
];

export function getTool(id: string): ToolMeta | undefined {
  return tools.find((t) => t.id === id);
}

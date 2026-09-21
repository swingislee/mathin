import type { LucideIcon } from "lucide-react";
import { Box, Boxes, Cylinder, Dice5, FoldVertical, Orbit, PanelsTopLeft, Route, Ruler, UnfoldVertical } from "lucide-react";
import {
  CLASSROOM_PARTITIONED_INPUT_PROVIDER_V1,
  type ClassroomInputCapabilityProvider,
} from "@/features/classroom/input/provider";

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
  /** Present only when the tool implements the versioned classroom input provider contract. */
  classroomInput?: ClassroomInputCapabilityProvider;
}

export const tools: ToolMeta[] = [
  {
    id: "fraction-line",
    no: 1,
    category: "number",
    grades: [3, 6],
    icon: Ruler,
    classroomInput: CLASSROOM_PARTITIONED_INPUT_PROVIDER_V1,
  },
  { id: "motion-lab", no: 2, category: "motion", grades: [4, 6], icon: Route },
  { id: "cube-structures", no: 3, category: "geometry", grades: [1, 9], icon: Boxes },
  { id: "cube-net", no: 4, category: "geometry", grades: [1, 9], icon: UnfoldVertical },
  { id: "solid-nets", no: 10, category: "geometry", grades: [1, 9], icon: FoldVertical },
  { id: "dice", no: 5, category: "geometry", grades: [1, 9], icon: Dice5 },
  { id: "projection", no: 6, category: "geometry", grades: [1, 9], icon: PanelsTopLeft },
  { id: "solid-geometry", no: 7, category: "geometry", grades: [1, 9], icon: Box },
  { id: "solid-capacity", no: 8, category: "geometry", grades: [5, 9], icon: Cylinder },
  { id: "solid-revolution", no: 11, category: "geometry", grades: [5, 9], icon: Orbit },
  { id: "soma-cube", no: 9, category: "geometry", grades: [1, 9], icon: Boxes },
];

export function getTool(id: string): ToolMeta | undefined {
  // 历史链接和冻结内容仍可解析；目录只展示独立教具。
  if (id === "spatial-lab") return { id, no: 3, category: "geometry", grades: [1, 9], icon: Boxes };
  return tools.find((t) => t.id === id);
}

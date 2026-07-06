import type { LucideIcon } from "lucide-react";
import { Route, Ruler } from "lucide-react";
import type { ComponentType } from "react";
import { FractionLine } from "./fraction-line/FractionLine";
import { MotionLab } from "./motion-lab/MotionLab";
import type { ToolComponentProps } from "./types";

export type ToolCategory = "number" | "geometry" | "motion" | "misc";

export interface ToolDef {
  /** 路由段（kebab-case），同时是 messages 里 tools.items 的 key */
  id: string;
  /** 图鉴编号（商人星球的 Nº 印花） */
  no: number;
  category: ToolCategory;
  /** 适用年级区间 */
  grades: [number, number];
  icon: LucideIcon;
  Component: ComponentType<ToolComponentProps>;
}

export const tools: ToolDef[] = [
  { id: "fraction-line", no: 1, category: "number", grades: [3, 6], icon: Ruler, Component: FractionLine },
  { id: "motion-lab", no: 2, category: "motion", grades: [4, 6], icon: Route, Component: MotionLab },
];

export function getTool(id: string): ToolDef | undefined {
  return tools.find((t) => t.id === id);
}

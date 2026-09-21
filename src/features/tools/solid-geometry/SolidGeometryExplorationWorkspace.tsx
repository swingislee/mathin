"use client";

import { SolidGeometrySharedWorkspace, type SolidGeometryExplorationWorkspaceProps } from "./SolidGeometryWorkspace";

/** 版本只决定参数合同；舞台、按钮、手柄与动画仍由同一工作台维护。 */
export function SolidGeometryExplorationWorkspace(props: Omit<SolidGeometryExplorationWorkspaceProps, "modern">) {
  return <SolidGeometrySharedWorkspace {...props} modern />;
}

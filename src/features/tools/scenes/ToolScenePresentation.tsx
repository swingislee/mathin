"use client";

import { createElement } from "react";
import type { ToolPresentationProps } from "./workbench-adapter";
import { getToolWorkbenchAdapter } from "./workbench-registry";

/** 课件展示与备课使用同一工具登记；固定副本改变时重置本实例。 */
export function ToolScenePresentation(props: ToolPresentationProps) {
  const adapter = getToolWorkbenchAdapter(props.scene.contentVersion);
  return createElement(adapter.Presentation, { ...props, key: JSON.stringify(props.scene.payload) });
}

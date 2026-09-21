"use client";

import type { ComponentProps, CSSProperties } from "react";
import { SpatialIconButton } from "./SpatialWorkbenchControls";
import { SpatialActionIcon } from "./SpatialActionIcon";
import type { SpatialActionId } from "./actions";

/** 功能按钮只提供动作 ID、状态与领域回调，SVG 和按钮外观在共用层维护。 */
export function SpatialActionButton({ action, iconClassName, iconStyle, ...props }: Omit<ComponentProps<typeof SpatialIconButton>, "children"> & {
  action: SpatialActionId; iconClassName?: string; iconStyle?: CSSProperties;
}) {
  return <SpatialIconButton {...props} data-spatial-action={action}><SpatialActionIcon action={action} className={iconClassName} style={iconStyle} /></SpatialIconButton>;
}

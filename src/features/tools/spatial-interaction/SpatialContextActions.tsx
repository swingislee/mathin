"use client";

import { Button } from "@/components/ui/button";
import { SpatialActionIcon } from "./SpatialActionIcon";
import type { SpatialActionId } from "./actions";

export interface SpatialContextAction {
  action: SpatialActionId;
  label: string;
  title?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

/** 对象旁只列当前可用的常用动作；领域回调与侧栏使用同一个操作终点。 */
export function SpatialContextActions({ label, actions }: { label: string; actions: readonly SpatialContextAction[] }) {
  return <div className="inline-flex select-none items-center gap-0.5 rounded-lg border border-line bg-paper/95 p-1 shadow-sm" role="toolbar" aria-label={label}
    data-spatial-object-actions data-spatial-context-actions onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
    {actions.map(({ action, label: text, title, active, disabled, onClick }) => <Button key={action} type="button" size="sm" variant={active ? "secondary" : "ghost"}
      className="h-9 gap-1 px-2 text-xs whitespace-nowrap" aria-label={title ?? text} title={title ?? text} aria-pressed={active} disabled={disabled} onClick={onClick} data-spatial-action={action}>
      <SpatialActionIcon action={action} className="size-4" />{text}
    </Button>)}
  </div>;
}

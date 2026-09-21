"use client";

import { useSyncExternalStore } from "react";
import { SpatialActionButton } from "@/features/tools/spatial-interaction/SpatialActionButton";
import { SpatialActionIcon } from "@/features/tools/spatial-interaction/SpatialActionIcon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SpatialCameraControlMessages {
  readonly axisSnap: string;
  readonly enableAxisSnap: string;
  readonly disableAxisSnap: string;
}

// 同一浏览器页面内的所有工作台共享个人偏好；不写入课件、课堂状态或数据库。
let axisSnapEnabled = false;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useSpatialAxisSnap(): boolean {
  return useSyncExternalStore(subscribe, () => axisSnapEnabled, () => false);
}
function toggleAxisSnap() {
  axisSnapEnabled = !axisSnapEnabled;
  listeners.forEach((listener) => listener());
}

export function SpatialAxisSnapButton({ messages, disabled, className, iconOnly = false, action = "cameraSnap" }: {
  readonly messages: SpatialCameraControlMessages;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly iconOnly?: boolean;
  readonly action?: "cameraSnap" | "moveSnap";
}) {
  const enabled = useSpatialAxisSnap();
  if (iconOnly) return <SpatialActionButton action={action} label={enabled ? messages.disableAxisSnap : messages.enableAxisSnap}
    active={enabled} disabled={disabled} className={className} onClick={toggleAxisSnap} />;
  return (
    <Button
      type="button"
      size="sm"
      variant={enabled ? "secondary" : "ghost"}
      className={cn("h-7 gap-1 px-2 text-xs", className)}
      disabled={disabled}
      aria-label={enabled ? messages.disableAxisSnap : messages.enableAxisSnap}
      title={enabled ? messages.disableAxisSnap : messages.enableAxisSnap}
      aria-pressed={enabled}
      onClick={toggleAxisSnap}
    >
      <SpatialActionIcon action={action} className="size-3.5" />
      {!iconOnly && messages.axisSnap}
    </Button>
  );
}

"use client";

import { useSyncExternalStore } from "react";
import { Magnet } from "lucide-react";
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

export function SpatialAxisSnapButton({ messages, disabled, className }: {
  readonly messages: SpatialCameraControlMessages;
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  const enabled = useSpatialAxisSnap();
  return (
    <Button
      type="button"
      size="sm"
      variant={enabled ? "secondary" : "ghost"}
      className={cn("h-7 gap-1 px-2 text-xs", className)}
      disabled={disabled}
      aria-label={enabled ? messages.disableAxisSnap : messages.enableAxisSnap}
      aria-pressed={enabled}
      onClick={toggleAxisSnap}
    >
      <Magnet aria-hidden="true" className="size-3.5" />
      {messages.axisSnap}
    </Button>
  );
}

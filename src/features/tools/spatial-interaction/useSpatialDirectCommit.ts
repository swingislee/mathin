"use client";

import { useCallback, useState } from "react";

/** 手动动作已在画面发生：等待课堂回执时保留终点，失败或外部替换时返回权威状态。 */
export function useSpatialDirectCommit<T>(authority: T, failed: boolean) {
  const [direct, setDirect] = useState<{ source: T; target: T } | null>(null);
  const clear = useCallback(() => setDirect(null), []);
  const hold = useCallback((target: T) => setDirect({ source: authority, target }), [authority]);
  return { displayed: direct?.source === authority && !failed ? direct.target : authority, target: direct?.target ?? null, hold, clear };
}

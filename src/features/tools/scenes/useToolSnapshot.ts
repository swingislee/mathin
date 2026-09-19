"use client";

import { useCallback, useRef, useState } from "react";

/** 共用离散现场入口：本地直接操作，课堂先持久化，由权威回显驱动一次动画。 */
export function useToolSnapshot<S>(initial: S, runtime?: { state?: S; onChange?: (next: S) => Promise<void> }) {
  const [local, setLocal] = useState(initial);
  const [publishing, setPublishing] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const update = useCallback((next: S): boolean => {
    if (!runtime) { setLocal(next); return true; }
    if (!runtime.onChange || pending.current) return false;
    pending.current = true; setPublishing(true); setFailed(false);
    void runtime.onChange(next).catch(() => setFailed(true)).finally(() => { pending.current = false; setPublishing(false); });
    return true;
  }, [runtime]);
  return { snapshot: runtime ? runtime.state ?? initial : local, update, publishing, failed };
}

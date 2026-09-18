"use client";

import { useEffect, useState } from "react";

/** 指针拖动仅在结束后导出稳定现场，配置窗口和课堂共用。 */
export function useSceneCapture<S>(snapshot: S | null, onSnapshot?: (snapshot: S | null) => void) {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) return;
    const finish = () => setDragging(false);
    window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", finish); window.addEventListener("blur", finish);
    return () => { window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", finish); window.removeEventListener("blur", finish); };
  }, [dragging]);
  useEffect(() => { onSnapshot?.(dragging ? null : snapshot); }, [onSnapshot, dragging, snapshot]);
  return { onPointerDownCapture: () => { if (onSnapshot) setDragging(true); } };
}

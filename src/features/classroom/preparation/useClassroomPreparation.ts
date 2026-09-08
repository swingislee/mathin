"use client";

import { useCallback, useState } from "react";

/** 保留已挂载的舞台，让往返候课延续板书、互动页和媒体状态。 */
export function useClassroomPreparation(initialView: "prep" | "live") {
  const [view, setView] = useState(() => ({
    phase: initialView,
    stageMounted: initialView === "live",
  }));
  const openPreparation = useCallback(() => {
    setView((previous) => ({ ...previous, phase: "prep" }));
  }, []);
  const enterStage = useCallback(() => {
    setView({ phase: "live", stageMounted: true });
  }, []);
  return { ...view, openPreparation, enterStage };
}

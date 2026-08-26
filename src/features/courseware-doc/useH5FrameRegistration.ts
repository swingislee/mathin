"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { H5PointerBridgeHost } from "./h5-pointer-protocol";

/** Shared iframe lifecycle seam for every courseware adapter. */
export function useH5FrameRegistration(
  pointerBridge: H5PointerBridgeHost | undefined,
  frameId: string,
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [frameGeneration, setFrameGeneration] = useState(0);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!pointerBridge || !iframe || frameGeneration === 0) return;
    return pointerBridge.registerFrame(frameId, iframe);
  }, [frameGeneration, frameId, pointerBridge]);

  const onFrameLoad = useCallback(() => {
    setFrameGeneration((generation) => generation + 1);
  }, []);

  return { iframeRef, frameGeneration, onFrameLoad } as const;
}

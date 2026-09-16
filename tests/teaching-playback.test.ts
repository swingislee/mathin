// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useCubeNetPlayback } from "@/features/tools/spatial-lab/useCubeNetPlayback";

describe("semantic playback timing", () => {
  it("seeks a late command across chained animations and ignores display-window blur", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let frameId = 0; const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.spyOn(Date, "now").mockReturnValue(10000);
    let playback!: ReturnType<typeof useCubeNetPlayback<number>>;
    function Probe() { playback = useCubeNetPlayback({ essential: true, interactive: false }); return null; }
    const host = document.createElement("div"), root = createRoot(host), finish = vi.fn();
    try {
      await act(async () => root.render(createElement(Probe)));
      await act(async () => {
        playback.seekFrom(8500);
        playback.start({ durationMs: 1000, sample: (t) => t, onFinish: () => {
          playback.start({ durationMs: 1000, sample: (t) => t, onFinish: finish });
        } });
      });
      expect(playback.frame).toBe(500);
      await act(async () => window.dispatchEvent(new Event("blur")));
      expect(frames.size).toBe(1);
      for (const now of [0, 500]) await act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(now)); });
      expect(finish).toHaveBeenCalledTimes(1); expect(playback.frame).toBeNull();
    } finally { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });
});

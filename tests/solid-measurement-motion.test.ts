// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEASUREMENT_LAYER_MS } from "@/features/tools/solid-measurement/measurement-contract";
import { useMeasurementLayers } from "@/features/tools/solid-measurement/useMeasurementLayers";

let container: HTMLDivElement, root: Root, now: number, frames: Map<number, FrameRequestCallback>, nextFrame: number;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); now = 1000; frames = new Map(); nextFrame = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function Harness({ target, identity }: { target: number; identity: string }) { return createElement("output", { "data-layer-frame": useMeasurementLayers(target, identity) }); }
async function render(target: number, identity = "solid") { await act(async () => root.render(createElement(StrictMode, null, createElement(Harness, { target, identity })))); }
async function advance(ms: number) { now += ms; const pending = [...frames.values()]; frames.clear(); await act(async () => pending.forEach((frame) => frame(now))); }
function value() { return Number(container.querySelector("output")?.getAttribute("data-layer-frame")); }

describe("measurement layer presentation without authoritative frame writes", () => {
  it("restores a late joiner directly and animates only subsequent discrete targets", async () => {
    await render(2); expect(value()).toBe(2); await advance(MEASUREMENT_LAYER_MS); expect(value()).toBe(2);
    await render(4); expect(value()).toBe(2); await advance(MEASUREMENT_LAYER_MS / 2); expect(value()).toBe(2.5);
    await advance(MEASUREMENT_LAYER_MS / 2); expect(value()).toBe(3); await advance(MEASUREMENT_LAYER_MS); expect(value()).toBe(4);
    await render(1, "different-solid"); expect(value()).toBe(1); await advance(MEASUREMENT_LAYER_MS); expect(value()).toBe(1);
  });
  it("changes direction smoothly when the teacher changes a target mid-layer", async () => {
    await render(0); await render(3); await advance(MEASUREMENT_LAYER_MS / 2); expect(value()).toBe(0.5);
    await render(0); expect(value()).toBe(0.5); await advance(MEASUREMENT_LAYER_MS / 4); expect(value()).toBeGreaterThan(0); expect(value()).toBeLessThan(0.5);
    await advance(MEASUREMENT_LAYER_MS); expect(value()).toBe(0); expect(frames.size).toBe(0);
  });
  it("keeps an opacity transition under reduced motion and cancels frames on unmount", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    await render(0); await render(2); await advance(50); expect(value()).toBe(0.5); await advance(150); expect(value()).toBe(2);
    await render(0); expect(frames.size).toBeGreaterThan(0); await act(async () => root.unmount()); expect(frames.size).toBe(0);
  });
});

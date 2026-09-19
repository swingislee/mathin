import { act, createElement, useLayoutEffect, useMemo } from "react";
import { createRoot } from "@react-three/fiber";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebGLRenderer } from "three";
import { appendCubeOperation, createCubeHistory, replayCubeHistory, type CubeHistory } from "@/features/tools/spatial-lab/cube-structures-contract";
import { cubeRotationOperation } from "@/features/tools/spatial-lab/cube-structures-rotation";
import { useCubeDisplayMotion } from "@/features/tools/spatial-lab/useCubeDisplayMotion";

type Motion = ReturnType<typeof useCubeDisplayMotion>;
function Probe({ history, sceneKey, onMoving, observe }: { history: CubeHistory; sceneKey: object; onMoving: (moving: boolean) => void; observe: (motion: Motion) => void }) {
  const state = useMemo(() => replayCubeHistory(history), [history]);
  const motion = useCubeDisplayMotion(state, sceneKey, onMoving, history);
  useLayoutEffect(() => observe(motion), [motion, observe]);
  return null;
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllGlobals(); });

async function setup(reduced = false) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { devicePixelRatio: 1, matchMedia: () => Object.assign(new EventTarget(), { matches: reduced }) }));
  const frames = new Map<number, FrameRequestCallback>(); let frameId = 0; let now = 100;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const canvas = Object.assign(new EventTarget(), { style: {}, getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }) }) as unknown as HTMLCanvasElement;
  const renderer = { domElement: canvas, setSize() {}, setPixelRatio() {}, render() {}, xr: Object.assign(new EventTarget(), { isPresenting: false, setAnimationLoop() {} }) } as unknown as WebGLRenderer;
  const root = createRoot(canvas);
  await root.configure({ gl: renderer, size: { width: 800, height: 600, top: 0, left: 0 }, frameloop: "never", dpr: 1 });
  const initial = createCubeHistory([{ x: 0, y: 0, z: 0 }]);
  let motion: Motion;
  const onMoving = vi.fn();
  const observe = (value: Motion) => { motion = value; };
  const render = async (history: CubeHistory) => act(async () => { root.render(createElement(Probe, { history, sceneKey: initial.initial, onMoving, observe })); });
  const frame = async (elapsed = 16) => { now += elapsed; const pending = [...frames.values()]; frames.clear(); await act(async () => { for (const callback of pending) callback(now); }); };
  await render(initial); await frame();
  cleanups.push(async () => { await act(async () => root.unmount()); });
  return { initial, motion: () => motion!, onMoving, render, frame };
}

describe("rotation motion hook", () => {
  it("animates a stationary-center cube, reverses on undo and does not repeat on acknowledgement", async () => {
    const rig = await setup();
    const next = appendCubeOperation(rig.initial, cubeRotationOperation(rig.initial.initial, ["cube-1"], "y", 1)!);
    await rig.render(next);
    expect(rig.motion().rotation?.angle).toBe(0);
    expect(rig.motion().moving).toBe(true);
    await rig.frame(); await rig.frame(325);
    expect(rig.motion().rotation?.angle).toBeCloseTo(Math.PI / 4);
    await rig.frame(400);
    expect(rig.motion().rotation).toBeNull();
    expect(rig.motion().moving).toBe(false);
    await rig.render(structuredClone(next)); await rig.frame();
    expect(rig.motion().rotation).toBeNull();
    await rig.render({ ...next, cursor: 0 }); await rig.frame(); await rig.frame(325);
    expect(rig.motion().rotation?.angle).toBeCloseTo(-Math.PI / 4);
    await rig.frame(400);
    expect(rig.motion().moving).toBe(false);
    expect(rig.onMoving).toHaveBeenLastCalledWith(false);
  });

  it("uses the final semantic state immediately for reduced motion", async () => {
    const rig = await setup(true);
    const next = appendCubeOperation(rig.initial, cubeRotationOperation(rig.initial.initial, ["cube-1"], "z", 1)!);
    await rig.render(next); await rig.frame();
    expect(rig.motion().rotation).toBeNull();
    expect(rig.motion().moving).toBe(false);
  });
});

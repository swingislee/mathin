import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "@react-three/fiber";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebGLRenderer } from "three";
import { applyCubeOperation, createCubeHistory, cubeDisplayPosition, type CubeStructureState } from "@/features/tools/spatial-lab/cube-structures-contract";
import { cubeDragPositions } from "@/features/tools/spatial-lab/cube-structures-drag";
import { useCubeDisplayMotion } from "@/features/tools/spatial-lab/useCubeDisplayMotion";

type Motion = ReturnType<typeof useCubeDisplayMotion>;
function Probe({ state, sceneKey, onMoving, observe }: { state: CubeStructureState; sceneKey: object; onMoving: (active: boolean) => void; observe: (motion: Motion) => void }) {
  const motion = useCubeDisplayMotion(state, sceneKey, onMoving);
  useLayoutEffect(() => observe(motion), [motion, observe]);
  return null;
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.unstubAllGlobals();
});

async function setup(reduced = false) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { devicePixelRatio: 1,
    matchMedia: () => Object.assign(new EventTarget(), { matches: reduced }) }));
  const frames = new Map<number, FrameRequestCallback>(); let frameId = 0; let now = 100;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const canvas = Object.assign(new EventTarget(), { style: {}, getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }) }) as unknown as HTMLCanvasElement;
  const renderer = { domElement: canvas, setSize() {}, setPixelRatio() {}, render() {},
    xr: Object.assign(new EventTarget(), { isPresenting: false, setAnimationLoop() {} }) } as unknown as WebGLRenderer;
  const root = createRoot(canvas);
  await root.configure({ gl: renderer, size: { width: 800, height: 600, top: 0, left: 0 }, frameloop: "never", dpr: 1 });
  const initial = createCubeHistory([{ x: 0, y: 0, z: 0 }]).initial;
  let motion: Motion;
  const samples: number[] = [];
  const onMoving = vi.fn();
  const observe = (value: Motion) => { motion = value; samples.push(cubeDisplayPosition(value.presentation.cubes[0]).x); };
  const render = (state: CubeStructureState) => root.render(createElement(Probe, { state, sceneKey: initial, onMoving, observe }));
  const frame = async (elapsed = 16) => { now += elapsed; const pending = [...frames.values()]; frames.clear(); await act(async () => { for (const callback of pending) callback(now); }); };
  await act(async () => { render(initial); }); await frame();
  cleanups.push(async () => { await act(async () => root.unmount()); });
  return { initial, motion: () => motion!, samples, onMoving, render, frame };
}

describe("drag preview connects to the existing motion hook", () => {
  it("release starts at the visible preview without flashing back to the old position", async () => {
    const rig = await setup();
    const original = JSON.stringify(rig.initial);
    await act(async () => rig.motion().previewPositions(cubeDragPositions(rig.initial, ["cube-1"], "x", 1.3)));
    expect(rig.motion().moving).toBe(false);
    expect(cubeDisplayPosition(rig.motion().presentation.cubes[0]).x).toBe(1.3);
    const beforeRelease = rig.samples.length;
    const target = applyCubeOperation(rig.initial, { kind: "move", ids: ["cube-1"], axis: "x", distance: 1 });
    await act(async () => { rig.motion().previewPositions(null); rig.render(target); });
    expect(cubeDisplayPosition(rig.motion().presentation.cubes[0]).x).toBe(1.3);
    await rig.frame(); await rig.frame(220);
    expect(cubeDisplayPosition(rig.motion().presentation.cubes[0]).x).toBeGreaterThan(1);
    expect(cubeDisplayPosition(rig.motion().presentation.cubes[0]).x).toBeLessThan(1.3);
    await rig.frame(500);
    expect(cubeDisplayPosition(rig.motion().presentation.cubes[0]).x).toBe(1);
    expect(rig.samples.slice(beforeRelease).every((x) => x >= 1 && x <= 1.3)).toBe(true);
    expect(rig.onMoving).toHaveBeenLastCalledWith(false);
    expect(JSON.stringify(rig.initial)).toBe(original);
  });

  it("canceling a preview smoothly returns to the unchanged logical state", async () => {
    const rig = await setup();
    await act(async () => rig.motion().previewPositions(cubeDragPositions(rig.initial, ["cube-1"], "x", 2)));
    await act(async () => rig.motion().previewPositions(null));
    expect(cubeDisplayPosition(rig.motion().presentation.cubes[0]).x).toBe(2);
    await rig.frame(); await rig.frame(250);
    expect(cubeDisplayPosition(rig.motion().presentation.cubes[0]).x).toBeGreaterThan(0);
    expect(cubeDisplayPosition(rig.motion().presentation.cubes[0]).x).toBeLessThan(2);
    await rig.frame(700);
    expect(cubeDisplayPosition(rig.motion().presentation.cubes[0]).x).toBe(0);
    expect(rig.initial.cubes[0].position.x).toBe(0);
  });

  it("reduced-motion still follows the pointer, then returns directly on cancellation", async () => {
    const rig = await setup(true);
    await act(async () => rig.motion().previewPositions(cubeDragPositions(rig.initial, ["cube-1"], "x", 1.2)));
    expect(cubeDisplayPosition(rig.motion().presentation.cubes[0]).x).toBe(1.2);
    await act(async () => rig.motion().previewPositions(null));
    expect(cubeDisplayPosition(rig.motion().presentation.cubes[0]).x).toBe(0);
    expect(rig.motion().moving).toBe(false);
  });
});

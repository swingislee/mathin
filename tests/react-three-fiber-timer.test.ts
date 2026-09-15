import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as fiber from "@react-three/fiber";
import { Timer } from "three";

const require = createRequire(import.meta.url);
const fiberDirectory = dirname(require.resolve("@react-three/fiber/package.json"));
type FiberRuntime = Pick<typeof fiber, "createRoot" | "_roots" | "advance">;
const esm = await import(pathToFileURL(join(fiberDirectory, "dist/events-b389eeca.esm.js")).href);
const builds: { name: string; runtime: FiberRuntime; timer: typeof Timer }[] = [
  { name: "ESM", runtime: { createRoot: esm.c, _roots: esm._, advance: esm.n }, timer: Timer },
  { name: "CJS development", runtime: require(join(fiberDirectory, "dist/react-three-fiber.cjs.dev.js")), timer: require("three").Timer },
  { name: "CJS production", runtime: require(join(fiberDirectory, "dist/react-three-fiber.cjs.prod.js")), timer: require("three").Timer },
];

let now = 1000;
let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
const cleanup: (() => void)[] = [];
function tick(milliseconds = 16) {
  now += milliseconds;
  const queued = [...frames];
  for (const [id, callback] of queued) {
    if (frames.delete(id)) callback(now);
  }
}

beforeEach(() => {
  now = 1000; nextFrame = 0; frames.clear();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
  // 根从未挂载 React/DOM 内容；排空共享帧循环后释放本次测试的时钟桩。
  tick(); frames.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function root(runtime: FiberRuntime) {
  const canvas = {} as HTMLCanvasElement;
  runtime.createRoot(canvas);
  const store = runtime._roots.get(canvas)!.store;
  const render = vi.fn();
  store.setState({ gl: { render } as unknown as fiber.RootState["gl"] });
  cleanup.push(() => { store.getState().internal.active = false; runtime._roots.delete(canvas); });
  return { store, state: store.getState(), render };
}

describe.each(builds)("Fiber Timer compatibility · $name", ({ runtime, timer }) => {
  it("creates a Timer-backed root without invoking the deprecated Clock constructor", () => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { state: { clock } } = root(runtime);
    expect(clock).toBeInstanceOf(timer);
    expect(warnings.mock.calls.flat().join(" ")).not.toMatch(/Clock.*deprecated/);
    expect(clock.running).toBe(false); expect(clock.autoStart).toBe(true);
    expect(clock.getDelta()).toBe(0);
    expect(clock.running).toBe(true); expect(clock.startTime).toBe(1000);
    now += 16;
    expect(clock.getDelta()).toBeCloseTo(0.016);
    expect(clock.elapsedTime).toBeCloseTo(0.016); expect(clock.oldTime).toBe(now);
    now += 4;
    expect(clock.getElapsedTime()).toBeCloseTo(0.02);
    expect(clock.getDelta()).toBe(0);
  });

  it("preserves stop/start, excludes stopped time, and resets elapsed time on restart", () => {
    const { state: { clock } } = root(runtime);
    clock.start(); now += 20; clock.stop();
    expect(clock.elapsedTime).toBeCloseTo(0.02);
    expect(clock.running).toBe(false); expect(clock.autoStart).toBe(false);
    now += 5000;
    expect(clock.getDelta()).toBe(0); expect(clock.getElapsedTime()).toBeCloseTo(0.02);
    clock.start(); expect(clock.elapsedTime).toBe(0); expect(clock.oldTime).toBe(now);
    now += 25; expect(clock.getDelta()).toBeCloseTo(0.025);
    clock.elapsedTime = 3; now += 10;
    expect(clock.getElapsedTime()).toBeCloseTo(3.01);
  });

  it("retains manual advance timestamps and cleanly returns to automatic time", () => {
    const { state, store, render } = root(runtime);
    const samples: number[][] = [];
    state.internal.subscribe({ current: (current, delta) => samples.push([delta, current.clock.elapsedTime]) }, 0, store);
    state.setFrameloop("never"); now += 4000;
    runtime.advance(2, false, store.getState());
    runtime.advance(2.25, false, store.getState());
    expect(samples).toEqual([[2, 2], [0.25, 2.25]]);
    expect(state.clock.oldTime).toBe(2); expect(state.clock.getDelta()).toBe(0);
    expect(render).toHaveBeenCalledTimes(2);
    state.setFrameloop("always"); expect(state.clock.elapsedTime).toBe(0);
    now += 16; runtime.advance(now, false, store.getState());
    expect(samples.at(-1)![0]).toBeCloseTo(0.016);
    expect(samples.at(-1)![1]).toBeCloseTo(0.016);
  });

  it("shares one delta across frame subscribers and keeps separate canvas clocks independent", () => {
    const first = root(runtime), second = root(runtime);
    first.state.clock.start(); second.state.clock.start();
    const samples: number[] = [];
    for (let index = 0; index < 2; index += 1) first.state.internal.subscribe({ current: (_, delta) => samples.push(delta) }, 0, first.store);
    now += 30; runtime.advance(now, false, first.store.getState());
    expect(samples).toEqual([0.03, 0.03]); expect(first.render).toHaveBeenCalledOnce();
    expect(second.state.clock.elapsedTime).toBe(0);
    first.state.clock.stop(); now += 20;
    expect(first.state.clock.getDelta()).toBe(0);
    expect(second.state.clock.getDelta()).toBeCloseTo(0.05);
  });

  it("renders demand frames only when invalidated and preserves the existing idle-time delta", () => {
    const { state, store, render } = root(runtime);
    const deltas: number[] = [];
    state.internal.subscribe({ current: (_, delta) => deltas.push(delta) }, 0, store);
    state.setFrameloop("demand"); state.internal.active = true;
    state.invalidate(); expect(frames.size).toBe(1);
    tick(); expect(render).toHaveBeenCalledOnce(); expect(deltas[0]).toBeCloseTo(0.016);
    expect(frames.size).toBe(0);
    tick(5000); expect(render).toHaveBeenCalledOnce();
    state.invalidate(); tick();
    expect(render).toHaveBeenCalledTimes(2); expect(deltas[1]).toBeCloseTo(5.016);
    expect(frames.size).toBe(0);
    state.setFrameloop("never"); state.invalidate(); expect(frames.size).toBe(0);
  });
});

it("records the pinned Fiber compatibility patch without changing its public Clock type", () => {
  const manifest = JSON.parse(readFileSync(join(fiberDirectory, "package.json"), "utf8"));
  expect(manifest.version).toBe("9.6.1");
  expect(readFileSync("pnpm-workspace.yaml", "utf8")).toContain("'@react-three/fiber@9.6.1': patches/@react-three__fiber@9.6.1.patch");
  expect(readFileSync(join(fiberDirectory, "dist/declarations/src/core/store.d.ts"), "utf8")).toContain("clock: THREE.Clock");
  const patch = readFileSync("patches/@react-three__fiber@9.6.1.patch", "utf8");
  expect(patch.match(/^diff --git /gm)).toHaveLength(3);
  expect(patch).not.toContain("console.warn");
});

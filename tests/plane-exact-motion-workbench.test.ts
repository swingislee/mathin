// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanarWorkbench } from "@/features/tools/planar-kit/PlanarWorkbench";
import { planarSnapshot, planarSnapshotForTool, type PlanarSnapshot, type PlanarState } from "@/features/tools/planar-kit/contract";
import { planarScene } from "@/features/tools/planar-kit/scene-registry";
import { planarCommit, planarPause } from "@/features/tools/planar-kit/presentation";
import { isExactTangramState } from "@/features/tools/plane-geometry/exact-state";

vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
let container: HTMLDivElement, root: Root, time: number, nextFrame: number, frames: Map<number, FrameRequestCallback>;
const capture = vi.fn<(state: PlanarState | null) => void>();
const current = () => capture.mock.calls.at(-1)?.[0];
const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const stage = () => container.querySelector<SVGSVGElement>("svg[viewBox='0 0 960 720']")!;
const hand = (target: "minute" | "hour") => stage().querySelector<SVGGElement>(`g[aria-label="${target}"]`)!;
const piece = (index = 0, english = false) => stage().querySelector<SVGGElement>(`g[aria-label="${english ? "Piece" : "纸片"} ${index + 1}"]`)!;
const drawnArea = (polygon: SVGPolygonElement) => {
  const points = polygon.getAttribute("points")!.split(" ").map((pair) => pair.split(",").map(Number));
  return Math.abs(points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]; return sum + point[0] * next[1] - point[1] * next[0]; }, 0)) / 2;
};
const paperArea = (index = 0, english = false) => drawnArea(piece(index, english).querySelector("polygon")!);
const position = (minutes: number, target: "minute" | "hour", turn = 0) => {
  const angle = (minutes * (target === "minute" ? 6 : 0.5) - 90 + turn) * Math.PI / 180, radius = target === "minute" ? 180 : 125;
  return { x: 480 + radius * Math.cos(angle), y: 350 + radius * Math.sin(angle) };
};
async function pointer(target: Element, type: string, point: { x: number; y: number }) {
  await act(async () => target.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX: point.x, clientY: point.y, pointerId: 1, isPrimary: true, button: 0 })));
}
async function tick(ms: number) {
  time += ms; const pending = [...frames.values()]; frames.clear(); await act(async () => pending.forEach((frame) => frame(time)));
}
const render = async (props: Partial<ComponentProps<typeof PlanarWorkbench>> = {}) => {
  await act(async () => root.render(createElement(PlanarWorkbench, { toolId: "plane-clock", locale: "zh", onSnapshot: capture, ...props })));
};
async function turnHand(minutes: number, target: "minute" | "hour", turn: number, cancel = false) {
  await pointer(hand(target), "pointerdown", position(minutes, target));
  for (let step = 15; step <= Math.abs(turn); step += 15) await pointer(stage(), "pointermove", position(minutes, target, step * Math.sign(turn)));
  expect(current()).toBeNull();
  await pointer(stage(), cancel ? "pointercancel" : "pointerup", position(minutes, target, turn));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); time = 1000; nextFrame = 0; frames = new Map(); capture.mockClear();
  vi.spyOn(Date, "now").mockImplementation(() => time);
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => { frames.set(++nextFrame, frame); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  Object.defineProperties(SVGSVGElement.prototype, {
    getScreenCTM: { configurable: true, value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) },
    setPointerCapture: { configurable: true, value: vi.fn() }, hasPointerCapture: { configurable: true, value: () => true }, releasePointerCapture: { configurable: true, value: vi.fn() },
  });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("clock hand motion in the shared workbench", () => {
  for (const target of ["minute", "hour"] as const) {
    it(`commits a full ${target} turn once and restores both linked hands with undo/redo`, async () => {
      const initial = planarScene("60").create(); await render({ initial });
      await turnHand(initial.params.minutes, target, 360);
      const endpoint = current()!;
      expect(endpoint.params.minutes).toBeCloseTo(initial.params.minutes + (target === "minute" ? 60 : 720), 8);
      expect(endpoint.params.start).toBe(initial.params.start); expect(endpoint.params.span).toBe(initial.params.span);
      expect(planarSnapshotForTool("plane-clock", "plane-clock-lesson-v1").safeParse(planarSnapshot(endpoint)).success).toBe(true);
      expect(frames.size).toBe(0); expect(container.querySelector('[role="alert"]')).toBeNull();
      await act(async () => button("撤销").click()); expect(current()).toEqual(initial); expect(button("撤销").disabled).toBe(true);
      await act(async () => button("重做").click()); expect(current()).toEqual(endpoint);
      await act(async () => button("恢复备好的起点").click()); expect(current()).toEqual(initial);
    });
  }

  it("cancels a cross-seam gesture and starts the next one from the restored time", async () => {
    const initial = planarScene("60").create(); await render({ initial });
    await turnHand(initial.params.minutes, "minute", 540, true);
    expect(current()).toEqual(initial); expect(button("撤销").disabled).toBe(true);
    await turnHand(initial.params.minutes, "minute", -90);
    expect(current()!.params.minutes).toBeCloseTo(105, 8);
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial);
  });

  it("publishes one multi-turn endpoint, retains it through acknowledgement and restores it for a viewer", async () => {
    const initial = planarScene("60").create(), snapshot = planarSnapshot(initial); let acknowledge: (() => void) | undefined;
    const changed = vi.fn<(_: PlanarSnapshot) => Promise<void>>(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
    await render({ initial, classroom: { state: snapshot, onChange: changed } });
    await turnHand(initial.params.minutes, "minute", 720);
    expect(changed).toHaveBeenCalledTimes(1); const endpoint = changed.mock.calls[0][0];
    expect(endpoint.current.params.minutes).toBeCloseTo(240, 8); expect(endpoint.past).toEqual([initial]); expect(endpoint.motion).toBeNull();
    await act(async () => { acknowledge!(); }); await render({ initial, classroom: { state: endpoint, onChange: changed } });
    expect(current()).toEqual(endpoint.current); expect(frames.size).toBe(0);
    await render({ initial, readOnly: true, classroom: { state: JSON.parse(JSON.stringify(endpoint)) } });
    expect(current()).toEqual(endpoint.current); expect(button("连续走时").disabled).toBe(true); expect(hand("minute").getAttribute("aria-disabled")).toBe("true");
    const from = position(240, "minute"), to = position(240, "minute", 60);
    await pointer(hand("minute"), "pointerdown", from); await pointer(stage(), "pointermove", to); await pointer(stage(), "pointerup", to);
    expect(current()).toEqual(endpoint.current); expect(changed).toHaveBeenCalledTimes(1);
  });
});

describe("tangram exact endpoints in the shared workbench", () => {
  for (const stop of ["暂停过程", "停在当前位置"]) {
    it(`keeps a half-flip unsaveable after ${stop}, then resumes to one rigid history endpoint`, async () => {
      const initial = planarScene("02").create(); await render({ toolId: "plane-tangram", initial });
      const initialAreas = Array.from({ length: 7 }, (_, index) => paperArea(index));
      expect(current()).toEqual(initial);
      await act(async () => button("选中纸片翻面").click()); await tick(325); expect(current()).toBeNull();
      await act(async () => button(stop).click()); expect(current()).toBeNull();
      expect(paperArea()).toBeCloseTo(0, 7); expect(button("继续过程").disabled).toBe(false);
      expect(button("选中纸片顺时针 45°").disabled).toBe(true); expect(piece().getAttribute("aria-disabled")).toBe("true");
      await act(async () => button("形状与准确参数").click());
      expect(container.querySelector<HTMLInputElement>('input[aria-label="选中纸片转角（°）"]')!.disabled).toBe(true);
      const polygon = piece().querySelector("polygon")!.getAttribute("points");
      await pointer(piece(), "pointerdown", { x: 460, y: 235 }); await pointer(stage(), "pointermove", { x: 500, y: 275 }); await pointer(stage(), "pointerup", { x: 500, y: 275 });
      expect(piece().querySelector("polygon")!.getAttribute("points")).toBe(polygon); expect(current()).toBeNull();
      await tick(500); expect(paperArea()).toBeCloseTo(0, 7); expect(current()).toBeNull();
      await act(async () => button("继续过程").click()); await tick(325);
      const endpoint = current()!; expect(isExactTangramState(endpoint)).toBe(true); expect(endpoint.params.reflection0).toBe(-1);
      expect(endpoint.points).toEqual(initial.points); expect(endpoint.params.count).toBe(7);
      initialAreas.forEach((area, index) => expect(paperArea(index)).toBeCloseTo(area, 7));
      expect(planarSnapshotForTool("plane-tangram", "plane-tangram-lesson-v1").safeParse(planarSnapshot(endpoint)).success).toBe(true);
      expect(capture.mock.calls.every(([state]: [PlanarState | null]) => state === null || isExactTangramState(state))).toBe(true);
      await act(async () => button("撤销").click()); expect(current()).toEqual(initial); expect(button("撤销").disabled).toBe(true);
      await act(async () => button("重做").click()); expect(current()).toEqual(endpoint);
    });
  }

  it("displays a paused classroom flip read-only, keeps its semantic motion and captures only the later endpoint", async () => {
    const definition = planarScene("02"), initial = definition.create(), action = definition.actions!.find((entry) => entry.id === "piece-mirror")!;
    const endpoint = action.run(initial, { selected: "piece0" }), motion = planarCommit(planarSnapshot(initial), initial, endpoint, { id: action.id, duration: action.duration!, now: time });
    const paused = planarPause(motion, time + 325, true), original = JSON.stringify(paused);
    await render({ toolId: "plane-tangram", initial, readOnly: true, locale: "en", classroom: { state: paused } });
    expect(current()).toBeNull(); expect(paperArea(0, true)).toBeCloseTo(0, 7);
    expect(button("Resume motion").disabled).toBe(true); expect(button("Flip selected piece").disabled).toBe(true); expect(piece(0, true).getAttribute("aria-disabled")).toBe("true");
    await pointer(piece(0, true), "pointerdown", { x: 460, y: 235 }); await pointer(stage(), "pointermove", { x: 510, y: 270 }); await pointer(stage(), "pointerup", { x: 510, y: 270 });
    expect(current()).toBeNull(); expect(JSON.stringify(paused)).toBe(original);
    await render({ toolId: "plane-tangram", initial, readOnly: true, locale: "en", classroom: { state: { ...motion, motion: null } } });
    expect(current()).toEqual(endpoint); expect(paperArea(0, true)).toBeCloseTo(28_900, 7);
  });

  it("reads an old static half-flip without changing it or offering it as a new saved material", async () => {
    const prepared = planarScene("02").create(), legacy = { ...prepared, params: { ...prepared.params, reflection0: 0.25 } }, serialized = JSON.stringify(legacy);
    await render({ toolId: "plane-tangram", initial: legacy, readOnly: true });
    expect(current()).toBeNull(); expect(paperArea()).toBeCloseTo(28_900 * 0.25, 7);
    expect(piece().getAttribute("aria-disabled")).toBe("true"); expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(JSON.stringify(legacy)).toBe(serialized);
    expect(planarSnapshotForTool("plane-tangram", "plane-tangram-lesson-v1").safeParse(planarSnapshot(legacy)).success).toBe(true);
  });
});

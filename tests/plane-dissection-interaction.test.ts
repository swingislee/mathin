// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaneDissectionWorkspace } from "@/features/tools/plane-dissection/PlaneDissectionWorkspace";
import { defaultPlaneDissection, type PlaneDissectionScene } from "@/features/tools/plane-dissection/model";

let root: Root, container: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>, clock: number, nextFrame: number;
const capture = vi.fn<(scene: PlaneDissectionScene | null) => void>();
const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const paper = () => container.querySelector<SVGPolygonElement>('polygon[aria-label="剪下的三角片"]')!;
const svg = () => container.querySelector("svg[viewBox]")!;
const pointer = async (target: Element, type: string, x: number, y: number, id = 1, primary = true) => {
  await act(async () => { target.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX: x, clientY: y, pointerId: id, isPrimary: primary, button: 0 })); });
};
const tick = async (ms: number) => { clock += ms; const pending = [...frames.values()]; frames.clear(); await act(async () => pending.forEach((frame) => frame(clock))); };
const current = () => capture.mock.calls.at(-1)?.[0];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  frames = new Map(); clock = 0; nextFrame = 0; capture.mockClear();
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.set(++nextFrame, cb); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  Object.defineProperties(SVGSVGElement.prototype, {
    getScreenCTM: { configurable: true, value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) },
    setPointerCapture: { configurable: true, value: vi.fn() }, hasPointerCapture: { configurable: true, value: () => true }, releasePointerCapture: { configurable: true, value: vi.fn() },
  });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const render = async (scene = { ...defaultPlaneDissection(), cut: true }, readOnly = false) => {
  await act(async () => root.render(createElement(PlaneDissectionWorkspace, { initial: scene, onSnapshot: capture, readOnly })));
};

describe("plane paper direct manipulation", () => {
  it("drags a paper in X and Y with one endpoint and no replay on release", async () => {
    await render();
    await pointer(paper(), "pointerdown", 220, 420);
    await pointer(svg(), "pointermove", 330, 365);
    expect(current()).toBeNull();
    await pointer(svg(), "pointerup", 330, 365);
    expect(current()?.offcut).toEqual({ x: 2, y: -1 });
    expect(frames.size).toBe(0);
    await act(async () => button("撤销").click());
    expect(current()?.offcut).toEqual({ x: 0, y: 0 });
  });
  it("previews a thin snap outline then smoothly settles once", async () => {
    await render();
    await pointer(paper(), "pointerdown", 220, 420);
    await pointer(svg(), "pointermove", 545, 424);
    expect(container.querySelector('[aria-label="吸附落点"]')).not.toBeNull();
    await pointer(svg(), "pointerup", 545, 424);
    expect(current()).toBeNull();
    await tick(90); expect(current()).toBeNull();
    await tick(90); expect(current()?.offcut).toEqual({ x: 6, y: 0 });
    expect(frames.size).toBe(0);
  });
  it("does not snap a selection tap and cancels a second pointer or lost capture", async () => {
    const initial = { ...defaultPlaneDissection(), cut: true, offcut: { x: 5.8, y: .1 } };
    await render(initial);
    await pointer(paper(), "pointerdown", 500, 400); await pointer(svg(), "pointerup", 500, 400);
    expect(current()?.offcut).toEqual(initial.offcut); expect(frames.size).toBe(0);
    await pointer(paper(), "pointerdown", 500, 400); await pointer(svg(), "pointermove", 400, 350);
    await pointer(svg(), "pointerdown", 400, 350, 2, false);
    expect(current()?.offcut).toEqual(initial.offcut);
    await pointer(paper(), "pointerdown", 500, 400); await pointer(svg(), "pointermove", 400, 350);
    await pointer(svg(), "lostpointercapture", 400, 350);
    expect(current()?.offcut).toEqual(initial.offcut);
  });
  it("animates cut, rearrange and restore, while undo remains one action each", async () => {
    await render(defaultPlaneDissection());
    await act(async () => button("沿高剪开").click());
    await tick(230); expect(paper()).toBeNull();
    await tick(230); expect(current()?.cut).toBe(true);
    await act(async () => button("演示拼合").click());
    await tick(500); expect(current()).toBeNull();
    await tick(500); expect(current()?.offcut.x).toBe(6);
    await act(async () => button("复原").click());
    await tick(350); expect(paper()).not.toBeNull();
    await tick(350); expect(current()?.cut).toBe(false);
    await act(async () => button("撤销").click());
    expect(current()?.offcut.x).toBe(6);
  });
  it("deselects empty taps and keeps read-only presentations inert", async () => {
    await render();
    await pointer(paper(), "pointerdown", 220, 420); await pointer(svg(), "pointerup", 220, 420);
    expect(paper().getAttribute("aria-pressed")).toBe("true");
    await pointer(svg(), "pointerdown", 50, 500);
    expect(paper().getAttribute("aria-pressed")).toBe("false");
    await render({ ...defaultPlaneDissection(), cut: true }, true);
    expect(button("复原").disabled).toBe(true);
    await pointer(paper(), "pointerdown", 220, 420); await pointer(svg(), "pointermove", 330, 350); await pointer(svg(), "pointerup", 330, 350);
    expect(current()?.offcut).toEqual({ x: 0, y: 0 });
  });
});

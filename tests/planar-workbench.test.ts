// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanarWorkbench } from "../src/features/tools/planar-kit/PlanarWorkbench";
import { planarSnapshot, planarStateSchema, type PlanarSnapshot, type PlanarState } from "../src/features/tools/planar-kit/contract";
import { planarScene } from "../src/features/tools/planar-kit/scene-registry";

vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
let container: HTMLDivElement, root: Root, clock: number, nextFrame: number, frames: Map<number, FrameRequestCallback>;
const capture = vi.fn<(state: PlanarState | null) => void>();
const current = () => capture.mock.calls.at(-1)?.[0];
const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const svg = () => container.querySelector<SVGSVGElement>("svg[viewBox='0 0 960 720']")!;
const shape = () => container.querySelector<SVGPolygonElement>('polygon[aria-label="拖动图形平移"]')!;
async function pointer(target: Element, type: string, x: number, y: number, pointerId = 1, isPrimary = true) {
  await act(async () => target.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX: x, clientY: y, pointerId, isPrimary, button: 0 })));
}
async function tick(ms: number) {
  clock += ms; const pending = [...frames.values()]; frames.clear();
  await act(async () => pending.forEach((frame) => frame(clock)));
}
const render = async (props: Partial<ComponentProps<typeof PlanarWorkbench>> = {}) => {
  await act(async () => root.render(createElement(PlanarWorkbench, { toolId: "plane-motion", locale: "zh", initial: planarScene("20").create(), onSnapshot: capture, ...props })));
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  clock = 1000; nextFrame = 0; frames = new Map(); capture.mockClear();
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => { frames.set(++nextFrame, frame); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: vi.fn() }, hasPointerCapture: { configurable: true, value: () => true }, releasePointerCapture: { configurable: true, value: vi.fn() },
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ x: 100, y: 100, left: 100, top: 100, right: 300, bottom: 120, width: 200, height: 20, toJSON: () => ({}) }));
  Object.defineProperties(SVGSVGElement.prototype, {
    getScreenCTM: { configurable: true, value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) },
    setPointerCapture: { configurable: true, value: vi.fn() }, hasPointerCapture: { configurable: true, value: () => true }, releasePointerCapture: { configurable: true, value: vi.fn() },
  });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("the shared planar workbench", () => {
  it("uses semantic controls and non-modal settings with a repeated-click exit", async () => {
    await render();
    expect(button("播放平移").dataset.spatialAction).toBe("play");
    expect(button("形状与准确参数").dataset.spatialAction).toBe("dimensions");
    expect(button("恢复备好的起点").dataset.spatialAction).toBe("reset");
    await act(async () => button("形状与准确参数").click());
    expect(container.querySelector("[data-cube-canvas-panel]")).not.toBeNull();
    await act(async () => button("形状与准确参数").click());
    expect(container.querySelector("[data-cube-canvas-panel]")).toBeNull();
  });
  it("commits a direct drag once, without replaying it, and restores the prepared origin", async () => {
    const initial = { ...planarScene("20").create(), params: { dx: 120, dy: 80 }, phase: 0.5 };
    await render({ initial });
    await pointer(shape(), "pointerdown", 330, 300); await pointer(svg(), "pointermove", 430, 350);
    expect(current()).toBeNull();
    await pointer(svg(), "pointerup", 430, 350);
    expect(current()?.params).toEqual({ dx: 160, dy: 90 });
    expect(frames.size).toBe(0);
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial);
    await act(async () => button("重做").click()); expect(current()?.params.dx).toBe(160);
    await act(async () => button("恢复备好的起点").click()); expect(current()).toEqual(initial);
  });
  it("cancels a second touch, lost capture, and Escape without committing a drag", async () => {
    const initial = planarScene("20").create(); await render({ initial });
    await pointer(shape(), "pointerdown", 300, 300); await pointer(svg(), "pointermove", 400, 350);
    await pointer(svg(), "pointerdown", 400, 350, 2, false); expect(current()).toEqual(initial);
    await pointer(shape(), "pointerdown", 300, 300); await pointer(svg(), "pointermove", 400, 350);
    await pointer(svg(), "lostpointercapture", 400, 350); expect(current()).toEqual(initial);
    await pointer(shape(), "pointerdown", 300, 300); await pointer(svg(), "pointermove", 400, 350);
    await act(async () => svg().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(current()).toEqual(initial);
  });
  it("keeps read-only and viewer instances inert", async () => {
    const initial = planarScene("20").create(); await render({ initial, readOnly: true });
    expect(button("播放平移").disabled).toBe(true);
    await pointer(shape(), "pointerdown", 300, 300); await pointer(svg(), "pointermove", 400, 350); await pointer(svg(), "pointerup", 400, 350);
    expect(current()).toEqual(initial);
    await render({ initial, classroom: { state: planarSnapshot(initial) } });
    expect(button("恢复备好的起点").disabled).toBe(true);
  });
  it("pauses at the visible phase, remains still, and resumes from there", async () => {
    await render(); await act(async () => button("播放平移").click());
    await tick(900); expect(current()).toBeNull();
    await act(async () => button("暂停过程").click()); expect(current()?.phase).toBeCloseTo(0.5);
    await tick(500); expect(current()?.phase).toBeCloseTo(0.5);
    await act(async () => button("继续过程").click()); await tick(900);
    expect(current()?.phase).toBe(1); expect(frames.size).toBe(0);
  });
  it("does not replay a classroom drag when its durable receipt arrives", async () => {
    const initial = planarScene("20").create(), snapshot = planarSnapshot(initial);
    let sent: PlanarSnapshot | undefined, resolve: (() => void) | undefined;
    const onChange = vi.fn((next: PlanarSnapshot) => { sent = next; return new Promise<void>((done) => { resolve = done; }); });
    await render({ initial, classroom: { state: snapshot, onChange } });
    await pointer(shape(), "pointerdown", 300, 300); await pointer(svg(), "pointermove", 440, 330); await pointer(svg(), "pointerup", 440, 330);
    expect(onChange).toHaveBeenCalledTimes(1); expect(sent?.current.params.dx).toBe(140); expect(sent?.motion).toBeNull();
    await act(async () => resolve!());
    await render({ initial, classroom: { state: sent, onChange } });
    expect(current()?.params.dx).toBe(140); expect(frames.size).toBe(0);
    await render({ initial, classroom: { state: structuredClone(sent!), onChange } });
    expect(current()?.params.dx).toBe(140); expect(frames.size).toBe(0);
  });
  it("immediately drops a local drag preview when edit permission is revoked", async () => {
    const initial = planarScene("20").create(); await render({ initial });
    await pointer(shape(), "pointerdown", 300, 300); await pointer(svg(), "pointermove", 400, 350);
    await render({ initial, readOnly: true });
    expect(current()).toEqual(initial);
    expect(shape().getAttribute("aria-disabled")).toBe("true");
  });
  it("replaces an in-progress preview when a different classroom authority arrives", async () => {
    const initial = planarScene("20").create(), onChange = vi.fn(async () => {}), snapshot = planarSnapshot(initial);
    await render({ initial, classroom: { state: snapshot, onChange } });
    await pointer(shape(), "pointerdown", 300, 300); await pointer(svg(), "pointermove", 400, 350);
    const replacement = planarSnapshot({ ...initial, phase: 1, params: { dx: -80, dy: 40 } });
    await render({ initial, classroom: { state: replacement, onChange } });
    expect(current()).toEqual(replacement.current);
    await pointer(svg(), "pointerup", 400, 350); expect(onChange).not.toHaveBeenCalled();
  });
  it("rolls a rejected classroom write back to the authority", async () => {
    const initial = planarScene("20").create(), snapshot = planarSnapshot(initial), onChange = vi.fn(async () => { throw new Error("write failed"); });
    await render({ initial, classroom: { state: snapshot, onChange } });
    await pointer(shape(), "pointerdown", 300, 300); await pointer(svg(), "pointermove", 440, 330); await pointer(svg(), "pointerup", 440, 330);
    expect(current()).toEqual(initial); expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(frames.size).toBe(0);
  });
  it("deselects a blank tap and does not mistake a completed object drag for one", async () => {
    await render();
    await pointer(shape(), "pointerdown", 300, 300); await pointer(svg(), "pointerup", 300, 300);
    expect(shape().getAttribute("aria-pressed")).toBe("true");
    await act(async () => svg().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(shape().getAttribute("aria-pressed")).toBe("true");
    await pointer(svg(), "pointerdown", 50, 550); await pointer(svg(), "pointerup", 50, 550);
    await act(async () => svg().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(shape().getAttribute("aria-pressed")).toBe("false");
  });
  it("cancels an active object gesture when the window loses focus", async () => {
    const initial = planarScene("20").create(); await render({ initial });
    await pointer(shape(), "pointerdown", 300, 300); await pointer(svg(), "pointermove", 400, 350);
    await act(async () => window.dispatchEvent(new Event("blur")));
    expect(current()).toEqual(initial);
    await pointer(svg(), "pointerup", 400, 350); expect(current()).toEqual(initial);
  });
  it("replaces an opened scene without waiting for a reset click", async () => {
    const first = planarScene("20").create(), second = { ...first, params: { dx: 60, dy: -80 }, phase: 1 };
    await render({ initial: first }); await render({ initial: second });
    expect(current()).toEqual(second);
  });
  it("snaps a fractional domino drag to a legal cell instead of rejecting the animation", async () => {
    const initial = planarScene("57").create(); await render({ toolId: "plane-covering", initial });
    const domino = container.querySelector('[aria-label="骨牌 1"]')!;
    await pointer(domino, "pointerdown", 370, 305); await pointer(svg(), "pointermove", 402, 305); await pointer(svg(), "pointerup", 402, 305);
    await tick(200);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(current()?.points.domino0).toEqual({ x: 2, y: 2 });
  });
  it("never exposes a fractional cutting frame as a prepared mathematical state", async () => {
    const initial = planarScene("14").create(); await render({ toolId: "plane-area", initial });
    await act(async () => button("沿下一条高剪开").click()); await tick(240);
    await act(async () => button("暂停过程").click());
    const captured = current(); expect(captured === null || planarStateSchema.safeParse(captured).success).toBe(true);
    await act(async () => button("选择教学现场").click());
    expect([...container.querySelectorAll<HTMLButtonElement>('[data-cube-canvas-panel] button')].filter((item) => !item.getAttribute("aria-label")).every((item) => item.disabled)).toBe(true);
    await act(async () => button("恢复备好的起点").click());
    expect(container.querySelector('[role="alert"]')).toBeNull(); expect(current()).toEqual(initial);
  });
  it("commits progress keyboard edits using the shared slider", async () => {
    await render(); await act(async () => button("显示设置").click());
    const slider = container.querySelector('[role="slider"][aria-label="演示位置"]')!;
    await act(async () => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(current()?.phase).toBeCloseTo(0.001, 6);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("does not submit an old slider preview over a new classroom authority", async () => {
    const initial = planarScene("20").create(), snapshot = planarSnapshot(initial), onChange = vi.fn(async () => {});
    await render({ initial, classroom: { state: snapshot, onChange } });
    await act(async () => button("显示设置").click());
    const slider = container.querySelector('[role="slider"][aria-label="演示位置"]')!, track = slider.closest('[dir="ltr"]')!;
    await pointer(track, "pointerdown", 200, 110); await pointer(track, "pointermove", 250, 110);
    expect(current()).toBeNull();
    const replacement = planarSnapshot({ ...initial, phase: 0.3, params: { dx: 85, dy: 25 } });
    await render({ initial, classroom: { state: replacement, onChange } });
    await pointer(track, "pointerup", 250, 110);
    expect(onChange).not.toHaveBeenCalled(); expect(current()).toEqual(replacement.current);
  });
  it("drops a slider preview on window blur and ignores its late pointerup", async () => {
    const initial = planarScene("20").create(); await render({ initial });
    await act(async () => button("显示设置").click());
    const slider = container.querySelector('[role="slider"][aria-label="演示位置"]')!, track = slider.closest('[dir="ltr"]')!;
    await pointer(track, "pointerdown", 200, 110); await pointer(track, "pointermove", 250, 110);
    expect(current()).toBeNull();
    await act(async () => window.dispatchEvent(new Event("blur")));
    expect(current()).toEqual(initial);
    await pointer(track, "pointerup", 250, 110);
    expect(current()).toEqual(initial);
  });
});

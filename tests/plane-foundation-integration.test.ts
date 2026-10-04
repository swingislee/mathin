// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanarWorkbench } from "@/features/tools/planar-kit/PlanarWorkbench";
import { planarSnapshot, type PlanarState } from "@/features/tools/planar-kit/contract";
import { addLineMaterial, lineMaterial, lineMetrics } from "@/features/tools/plane-lines/model";
import { createLinesState } from "@/features/tools/plane-lines/model";
import { createClassroomToolState, parseClassroomToolState, type ClassroomToolUpdate } from "@/features/tools/courseware/tool-classroom";
import { parseToolScene } from "@/features/tools/scenes/contract";
import { toolSceneOriginHash } from "@/features/tools/scenes/classroom-envelope";

vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
let container: HTMLDivElement, root: Root;
const capture = vi.fn<(state: PlanarState | null) => void>(), current = () => capture.mock.calls.at(-1)?.[0];
const button = (name: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const svg = () => container.querySelector<SVGSVGElement>("svg[viewBox='0 0 960 720']")!;
const render = async (props: Partial<ComponentProps<typeof PlanarWorkbench>> = {}) => {
  await act(async () => root.render(createElement(PlanarWorkbench, { toolId: "plane-geometry", locale: "zh", onSnapshot: capture, ...props })));
};
async function pointer(target: Element, type: string, x: number, y: number, pointerId = 1, isPrimary = true) {
  await act(async () => target.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX: x, clientY: y, pointerId, isPrimary, button: 0 })));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); capture.mockClear();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", () => 1); vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
  Object.defineProperties(SVGSVGElement.prototype, {
    getScreenCTM: { configurable: true, value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) },
    setPointerCapture: { configurable: true, value: vi.fn() }, hasPointerCapture: { configurable: true, value: () => true }, releasePointerCapture: { configurable: true, value: vi.fn() },
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ x: 100, y: 100, left: 100, top: 100, right: 300, bottom: 120, width: 200, height: 20, toJSON: () => ({}) }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("open line and angle host", () => {
  it("adds multiple materials in one workspace and undoes exactly one addition", async () => {
    await render(); expect(container.querySelector('[aria-label="教学现场"]')).toBeNull();
    await act(async () => button("添加图形或生活实例").click());
    await act(async () => button("添加线段").click()); expect(current()?.params.count).toBe(1);
    const first = structuredClone(current());
    await act(async () => button("添加图形或生活实例").click());
    await act(async () => button("添加角").click()); expect(current()?.params.count).toBe(2);
    expect(lineMaterial(current()!, 0)).toEqual(lineMaterial(first!, 0));
    await act(async () => button("撤销").click()); expect(current()).toEqual(first);
  });
  it("directly grabs an unselected material, commits only on release and cancels a second touch", async () => {
    const initial = addLineMaterial(addLineMaterial(createLinesState(), 3), 0); await render({ initial });
    const body = () => container.querySelector('[data-line-material="0"] > g[role="button"]')!;
    await pointer(body(), "pointerdown", 180, 250); await pointer(svg(), "pointermove", 240, 280); expect(current()).toBeNull();
    await pointer(svg(), "pointerup", 240, 280); const moved = current()!;
    expect(moved.params.active).toBe(0); expect(lineMaterial(moved, 0)?.a).toEqual({ x: 240, y: 280 });
    expect(lineMaterial(moved, 1)).toEqual(lineMaterial(initial, 1));
    await pointer(body(), "pointerdown", 240, 280); await pointer(svg(), "pointermove", 320, 310);
    await pointer(svg(), "pointerdown", 350, 320, 2, false); expect(current()).toEqual(moved);
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial);
  });
  it("shows endpoint handles only in the chosen operation and keeps a changed angle after closing it", async () => {
    const initial = addLineMaterial(createLinesState(), 3); await render({ initial });
    const body = container.querySelector('[data-line-material="0"] > g[role="button"]')!;
    await pointer(body, "pointerdown", 180, 250); await pointer(svg(), "pointerup", 180, 250);
    expect(container.querySelector("[data-line-handle]")).toBeNull();
    await act(async () => button("编辑当前材料定位点").click());
    const handle = container.querySelector('[data-line-handle="c"]')!;
    await pointer(handle, "pointerdown", 180, 442); await pointer(svg(), "pointermove", 300, 410); await pointer(svg(), "pointerup", 300, 410);
    expect(lineMetrics(lineMaterial(current()!)!).angle).toBeCloseTo(53.130102);
    const changed = structuredClone(current()); await act(async () => button("编辑当前材料定位点").click());
    expect(container.querySelector("[data-line-handle]")).toBeNull(); expect(current()).toEqual(changed);
  });
  it("keeps read-only geometry and classroom late-join state on the exact same version", async () => {
    const initial = addLineMaterial(createLinesState(), 6), saved = parseToolScene({ toolId: "plane-geometry", contentVersion: "plane-geometry-lesson-v2", payload: { title: "Parallel", initial } });
    const update = { toolId: "plane-geometry", contentVersion: "plane-geometry-lesson-v2", state: planarSnapshot(initial) } as ClassroomToolUpdate;
    const event = createClassroomToolState("page", "doc", "instance", update, toolSceneOriginHash(saved.payload));
    expect(parseClassroomToolState(event)).toEqual(event);
    await render({ initial, readOnly: true }); expect(button("复制当前材料").disabled).toBe(true);
    const body = container.querySelector('[data-line-material="0"] > g[role="button"]')!;
    await pointer(body, "pointerdown", 180, 250); await pointer(svg(), "pointermove", 300, 400); await pointer(svg(), "pointerup", 300, 400);
    expect(current()).toEqual(initial); expect(container.querySelector("[data-line-handle]")).toBeNull();
    await render({ initial, classroom: { state: update.state as ReturnType<typeof planarSnapshot> } });
    expect(button("移除当前材料").disabled).toBe(true); expect(current()).toEqual(initial);
  });
});

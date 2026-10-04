// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanarWorkbench } from "@/features/tools/planar-kit/PlanarWorkbench";
import { planarSnapshot, planarSnapshotForTool, type PlanarPoint, type PlanarSnapshot, type PlanarState } from "@/features/tools/planar-kit/contract";
import { planarCommit, planarPause } from "@/features/tools/planar-kit/presentation";
import { freezeToolScene, parseToolScene } from "@/features/tools/scenes/contract";
import { constructionObject, constructionObjects, createConstructionState, transformConstruction } from "@/features/tools/plane-construction/model";
import { planeConstructionScenes } from "@/features/tools/plane-construction/scenes";
import { isValidConstructionState } from "@/features/tools/plane-construction/validation";
import { rotatePoint } from "@/features/tools/plane-motion/model";
import { planeConstructionMotionCases } from "./fixtures/plane-construction-motion-cases";

vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
let container: HTMLDivElement, root: Root, time: number, nextFrame: number, frames: Map<number, FrameRequestCallback>;
const capture = vi.fn<(state: PlanarState | null) => void>();
const current = () => capture.mock.calls.at(-1)?.[0];
const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const stage = () => container.querySelector<SVGSVGElement>("svg[viewBox='0 0 960 720']")!;
const body = (id = 0) => container.querySelector<SVGGElement>(`[data-spatial-toolbar-content] [data-construction-object="${id}"] [data-construction-body]`)!;
const matrix = (id = 0) => body(id).querySelector("g[transform]")!.getAttribute("transform")!.slice(7, -1).split(" ").map(Number);
const determinant = () => { const [a, b, c, d] = matrix(); return a * d - b * c; };
const render = async (props: Partial<ComponentProps<typeof PlanarWorkbench>> = {}) => {
  await act(async () => root.render(createElement(PlanarWorkbench, { toolId: "plane-motion", locale: "zh", onSnapshot: capture, ...props })));
};
async function pointer(target: Element, type: string, point: PlanarPoint) {
  await act(async () => target.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX: point.x, clientY: point.y, pointerId: 1, isPrimary: true, button: 0 })));
}
async function tick(ms: number) {
  time += ms; const pending = [...frames.values()]; frames.clear(); await act(async () => pending.forEach((frame) => frame(time)));
}
async function foldTo(x: number, cancel = false) {
  await pointer(body(), "pointerdown", { x: 380, y: 340 });
  await pointer(stage(), "pointermove", { x, y: 340 }); expect(current()).toBeNull();
  await pointer(stage(), cancel ? "pointercancel" : "pointerup", { x, y: 340 });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); time = 1000; nextFrame = 0; frames = new Map(); capture.mockClear();
  vi.spyOn(Date, "now").mockImplementation(() => time);
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => { frames.set(++nextFrame, frame); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  Object.defineProperties(SVGSVGElement.prototype, {
    getScreenCTM: { configurable: true, value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) },
    setPointerCapture: { configurable: true, value: vi.fn() }, hasPointerCapture: { configurable: true, value: () => true }, releasePointerCapture: { configurable: true, value: vi.fn() },
  });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("motion operations through the shared workbench", () => {
  it("uses the live translation origin for corresponding points and clears gesture-only data on release", async () => {
    const base = createConstructionState("20-create"), initial = { ...base, flags: { ...base.flags, ghost: true, vertices: true } };
    await render({ initial }); await act(async () => button("准确平移").click());
    await pointer(body(), "pointerdown", { x: 380, y: 340 }); await pointer(stage(), "pointermove", { x: 431.5, y: 302.75 });
    expect(current()).toBeNull(); expect(container.querySelector('[data-spatial-toolbar-content] [data-construction-correspondences="actual"]')).not.toBeNull();
    await pointer(stage(), "pointerup", { x: 431.5, y: 302.75 });
    expect(current()!.points["center.0"]).toEqual({ x: 431.5, y: 302.75 }); expect(isValidConstructionState(current()!)).toBe(true); expect(frames.size).toBe(0);
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial); expect(button("撤销").disabled).toBe(true);
  });
  it("rotates continuously across seams, commits once, and returns to ordinary dragging when closed", async () => {
    const initial = createConstructionState("20-create"); await render({ initial }); await act(async () => button("绕点旋转").click());
    const down = { x: 580, y: 360 };
    await pointer(body(), "pointerdown", down);
    for (let angle = 30; angle <= 450; angle += 30) await pointer(stage(), "pointermove", rotatePoint(down, initial.points.pivot, angle));
    expect(current()).toBeNull(); await pointer(stage(), "pointerup", rotatePoint(down, initial.points.pivot, 450));
    const endpoint = current()!; expect(endpoint.params["angle.0"]).toBeCloseTo(450); expect(isValidConstructionState(endpoint)).toBe(true);
    expect(frames.size).toBe(0); expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => button("关闭面板").click()); expect(current()).toEqual(endpoint); expect(body().getAttribute("data-construction-body")).toBe("object.0");
    expect(container.querySelector("[data-construction-guide]")).toBeNull();
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial); expect(button("撤销").disabled).toBe(true);
    await act(async () => button("重做").click()); expect(current()).toEqual(endpoint);
    const center = constructionObject(endpoint)!.center;
    await pointer(body(), "pointerdown", center); await pointer(stage(), "pointermove", { x: center.x + 20, y: center.y + 30 }); await pointer(stage(), "pointerup", { x: center.x + 20, y: center.y + 30 });
    expect(current()!.params["angle.0"]).toBe(endpoint.params["angle.0"]); expect(current()!.points["center.0"].x).toBeCloseTo(center.x + 20);
  });
  it("keeps direct folds unsaveable during projection, restores cancel, and commits one accurate mirror", async () => {
    const initial = createConstructionState("20-create"); await render({ initial }); await act(async () => button("沿轴镜像").click());
    await pointer(body(), "pointerdown", { x: 380, y: 340 }); await pointer(stage(), "pointermove", { x: 480, y: 340 });
    expect(current()).toBeNull(); expect(determinant()).toBeCloseTo(0, 7);
    await pointer(stage(), "pointercancel", { x: 480, y: 340 }); expect(current()).toEqual(initial); expect(determinant()).toBeCloseTo(1);
    expect(button("撤销").disabled).toBe(true);
    await foldTo(530); const endpoint = current()!;
    expect(endpoint).toEqual(transformConstruction(initial, "reflect")); expect(determinant()).toBeCloseTo(-1); expect(frames.size).toBe(0);
    expect(container.querySelector('[role="alert"]')).toBeNull(); expect(Object.keys(endpoint.params).some((key) => key.startsWith("frame"))).toBe(false);
    expect(capture.mock.calls.every(([state]: [PlanarState | null]) => state === null || isValidConstructionState(state))).toBe(true);
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial); expect(button("撤销").disabled).toBe(true);
    await act(async () => button("重做").click()); expect(current()).toEqual(endpoint);
  });
  it("lands a short fold back at its starting geometry without creating false history", async () => {
    const initial = createConstructionState("20-create"); await render({ initial }); await act(async () => button("沿轴镜像").click());
    await foldTo(440); expect(current()).toEqual(initial); expect(button("撤销").disabled).toBe(true); expect(frames.size).toBe(0);
  });
  it("cancels an in-progress operation with Escape and preserves the prepared material", async () => {
    const initial = createConstructionState("20-create"); await render({ initial }); await act(async () => button("绕点旋转").click());
    await pointer(body(), "pointerdown", { x: 580, y: 360 }); await pointer(stage(), "pointermove", { x: 480, y: 460 }); expect(current()).toBeNull();
    await act(async () => stage().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(current()).toEqual(initial); expect(body().getAttribute("data-construction-body")).toBe("object.0"); expect(button("撤销").disabled).toBe(true);
  });
  it("publishes one exact fold, retains the endpoint through acknowledgement, and restores a readonly viewer", async () => {
    const initial = createConstructionState("20-create"); let acknowledge: (() => void) | undefined;
    const changed = vi.fn<(_: PlanarSnapshot) => Promise<void>>(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
    await render({ initial, classroom: { state: planarSnapshot(initial), onChange: changed } }); await act(async () => button("沿轴镜像").click()); await foldTo(530);
    expect(changed).toHaveBeenCalledTimes(1); const snapshot = changed.mock.calls[0][0];
    expect(snapshot.motion).toBeNull(); expect(snapshot.past).toEqual([initial]); expect(snapshot.current).toEqual(transformConstruction(initial, "reflect"));
    expect(planarSnapshotForTool("plane-motion", "plane-motion-lesson-v2").safeParse(snapshot).success).toBe(true); expect(determinant()).toBeCloseTo(-1);
    await act(async () => { acknowledge!(); }); await render({ initial, classroom: { state: snapshot, onChange: changed } }); expect(current()).toEqual(snapshot.current); expect(frames.size).toBe(0);
    await render({ initial, readOnly: true, locale: "en", classroom: { state: JSON.parse(JSON.stringify(snapshot)) } });
    expect(body().getAttribute("aria-disabled")).toBe("true"); expect(button("Rotate around a point").disabled).toBe(true);
    const center = constructionObject(snapshot.current)!.center;
    await pointer(body(), "pointerdown", center); await pointer(stage(), "pointermove", { x: center.x + 50, y: center.y }); await pointer(stage(), "pointerup", { x: center.x + 50, y: center.y });
    expect(current()).toEqual(snapshot.current); expect(changed).toHaveBeenCalledTimes(1);
  });
  it("uses a real selectable parts count and generates a separately undoable batch", async () => {
    await render(); await act(async () => button("绕点旋转").click());
    const selector = container.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="绕一周的总份数（含原片）"]')!;
    await act(async () => selector.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((entry) => entry.textContent === "6 份")!;
    expect(option).toBeDefined(); await act(async () => option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(current()!.params.turn).toBe(60); const prepared = current()!;
    await act(async () => button("按总份数绕中心生成独立副本（含原片）").click()); expect(current()).toBeNull(); await tick(1600);
    const endpoint = current()!; expect(constructionObjects(endpoint)).toHaveLength(6); expect(isValidConstructionState(endpoint)).toBe(true);
    expect(constructionObject(endpoint, 0)).toEqual(constructionObject(prepared, 0));
    await act(async () => button("撤销").click()); expect(current()).toEqual(prepared);
    await act(async () => button("重做").click()); expect(current()).toEqual(endpoint);
    const frozen = freezeToolScene(parseToolScene({ toolId: "plane-motion", contentVersion: "plane-motion-lesson-v2", payload: { title: "Six independent pieces", initial: endpoint } }));
    if (frozen.toolId !== "plane-motion") throw new Error("Unexpected tool");
    endpoint.points["center.1"].x = 0; expect(frozen.payload.initial.points["center.1"].x).not.toBe(0);
  });
  it("keeps a paused half-fold unsaveable until resumed and exposes exact fractional axis settings", async () => {
    const initial = createConstructionState("20-create"); await render({ initial }); await act(async () => button("沿轴镜像").click());
    const axis = container.querySelector<HTMLInputElement>('input[aria-label="对称轴方向（°）"]')!; expect(axis.getAttribute("step")).toBe("any");
    await act(async () => { axis.value = "37.125"; axis.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(current()!.params.axisAngle).toBe(37.125); const prepared = current()!;
    await act(async () => button("翻到对称位置").click()); await tick(700); expect(current()).toBeNull(); expect(determinant()).toBeCloseTo(0, 7);
    await act(async () => button("停在当前位置").click()); expect(current()).toBeNull(); expect(button("继续过程").disabled).toBe(false);
    await act(async () => button("继续过程").click()); await tick(700); expect(current()).toEqual(transformConstruction(prepared, "reflect")); expect(determinant()).toBeCloseTo(-1);
  });
  it("reconstructs a paused readonly reflection from the existing v2 semantic motion", async () => {
    const definition = planeConstructionScenes.find((scene) => scene.id === "20-create")!, initial = definition.create();
    const action = definition.operations!.find((entry) => entry.id === "reflect")!.actions![0], endpoint = action.run(initial, { selected: null });
    const snapshot = planarCommit(planarSnapshot(initial), initial, endpoint, { id: action.id, duration: action.duration!, now: time });
    const paused = planarPause(snapshot, time + 700, true);
    await render({ initial, readOnly: true, locale: "en", classroom: { state: paused } }); expect(current()).toBeNull(); expect(determinant()).toBeCloseTo(0, 7);
    expect(body().getAttribute("aria-disabled")).toBe("true"); expect(button("Resume motion").disabled).toBe(true);
    await render({ initial, readOnly: true, classroom: { state: { ...snapshot, motion: null } } }); expect(current()).toEqual(endpoint); expect(determinant()).toBeCloseTo(-1);
  });
  it("keeps the existing scene envelope and rejects transient projection or guessed group relationships", () => {
    for (const entry of planeConstructionMotionCases()) {
      if (entry.accepted) expect(() => parseToolScene(entry.scene), entry.label).not.toThrow(); else expect(() => parseToolScene(entry.scene), entry.label).toThrow();
    }
  });
});

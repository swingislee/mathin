// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanarWorkbench } from "@/features/tools/planar-kit/PlanarWorkbench";
import { planarSnapshot, type PlanarState } from "@/features/tools/planar-kit/contract";
import { addLineMaterial, lineMaterial, lineMetrics } from "@/features/tools/plane-lines/model";
import { emptyLinesState } from "@/features/tools/plane-lines/model";
import { createClassroomToolState, parseClassroomToolState, type ClassroomToolUpdate } from "@/features/tools/courseware/tool-classroom";
import { parseToolScene, toolSceneSchema } from "@/features/tools/scenes/contract";
import { toolSceneOriginHash } from "@/features/tools/scenes/classroom-envelope";
import { constructPaperLayers, foldStep, paperCuts } from "@/features/tools/plane-paper-layers/model";
import { firstFoldState, planePaperLayersCases, twoFoldState } from "./fixtures/plane-paper-layers-cases";

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
    await render({ initial: emptyLinesState() }); expect(container.querySelector('[aria-label="教学现场"]')).toBeNull();
    await act(async () => button("添加图形或生活实例").click());
    await act(async () => button("添加线段").click()); expect(current()?.params.count).toBe(1);
    const first = structuredClone(current());
    await act(async () => button("添加图形或生活实例").click());
    await act(async () => button("添加角").click()); expect(current()?.params.count).toBe(2);
    expect(lineMaterial(current()!, 0)).toEqual(lineMaterial(first!, 0));
    await act(async () => button("撤销").click()); expect(current()).toEqual(first);
  });
  it("directly grabs an unselected material, commits only on release and cancels a second touch", async () => {
    const initial = addLineMaterial(addLineMaterial(emptyLinesState(), 3), 0); await render({ initial });
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
    const initial = addLineMaterial(emptyLinesState(), 3); await render({ initial });
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
    const initial = addLineMaterial(emptyLinesState(), 6), saved = parseToolScene({ toolId: "plane-geometry", contentVersion: "plane-geometry-lesson-v2", payload: { title: "Parallel", initial } });
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
  it("keeps precise lengths on blur instead of offsetting them by the minimum", async () => {
    const initial = addLineMaterial(emptyLinesState(), 3); await render({ initial });
    await act(async () => button("形状与准确参数").click());
    const input = () => container.querySelector<HTMLInputElement>('input[aria-label="AB／量角器半径（u）"]')!;
    await act(async () => input().dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(lineMetrics(lineMaterial(current()!)!).length).toBeCloseTo(240, 9);
    await act(async () => { input().value = "6"; input().dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(lineMetrics(lineMaterial(current()!)!).length).toBeCloseTo(240, 9);
    await act(async () => button("准确张角").click());
    const arm = container.querySelector<HTMLInputElement>('input[aria-label="第二臂长（u）"]')!;
    await act(async () => { arm.value = "3.25"; arm.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(lineMetrics(lineMaterial(current()!)!).secondLength).toBeCloseTo(130, 9);
  });
});

describe("two-fold paper through the shared host", () => {
  it("preserves every strict versioned fixture through the actual scene contract", () => {
    for (const entry of planePaperLayersCases()) expect(toolSceneSchema.safeParse(entry.scene).success, entry.label).toBe(entry.accepted);
  });
  it("commits a directly dragged semantic fold angle once and cancels the next gesture", async () => {
    const initial = foldStep(firstFoldState(), true); await render({ toolId: "plane-folding", initial });
    const paper = () => container.querySelector('[data-paper-layer="1"] g[role="button"]')!;
    await pointer(paper(), "pointerdown", 360, 300); await pointer(svg(), "pointermove", 490, 300); expect(current()).toBeNull();
    await pointer(svg(), "pointerup", 490, 300); const folded = current()!;
    expect(folded.params["foldAngle.0"]).toBeCloseTo(90); expect(folded.params.layerFrame).toBeUndefined();
    expect(folded.points).toEqual(initial.points);
    await pointer(paper(), "pointerdown", 490, 300); await pointer(svg(), "pointermove", 425, 300);
    await pointer(svg(), "pointercancel", 425, 300); expect(current()).toEqual(folded);
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial); expect(button("撤销").disabled).toBe(true);
    await act(async () => button("重做").click()); expect(current()).toEqual(folded);
  });
  it("moves one cut from its doubly reflected unfolded copy without changing another cut", async () => {
    const circle = constructPaperLayers(twoFoldState(), "cut-circle", [{ x: 590, y: 450 }, { x: 610, y: 450 }])!;
    const twoCuts = constructPaperLayers(circle, "cut-polygon", [{ x: 640, y: 540 }, { x: 720, y: 540 }, { x: 680, y: 585 }])!;
    const initial = foldStep(foldStep(twoCuts, true), true); await render({ toolId: "plane-folding", initial });
    const copy = container.querySelector('[data-paper-handle="cut-body.1.0.3"]')!; expect(copy).not.toBeNull();
    await pointer(copy, "pointerdown", 370, 290); await pointer(svg(), "pointermove", 380, 295); expect(current()).toBeNull();
    await pointer(svg(), "pointerup", 380, 295);
    expect(current()!.points["cut.1.0"]).toEqual({ x: 580, y: 445 });
    expect(paperCuts(current()!)[1]).toEqual(paperCuts(initial)[1]); expect(current()!.params.activeCut).toBe(1);
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial); expect(button("撤销").disabled).toBe(true);
  });
  it("keeps animated projection out of saved state and resumes the same layer after pausing", async () => {
    let time = 1000, nextFrame = 0; const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(Date, "now").mockImplementation(() => time);
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => { frames.set(++nextFrame, frame); return nextFrame; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const tick = async (ms: number) => { time += ms; const pending = [...frames.values()]; frames.clear(); await act(async () => pending.forEach((frame) => frame(time))); };
    const initial = twoFoldState(); await render({ toolId: "plane-folding", initial });
    await act(async () => button("慢慢展开一层").click()); await tick(450); expect(current()).toBeNull();
    await act(async () => button("停在当前位置").click()); expect(current()).toBeNull(); expect(button("继续过程").disabled).toBe(false);
    await act(async () => button("继续过程").click()); await tick(1350);
    expect(current()).toEqual(foldStep(initial, true)); expect(current()!.params["foldAngle.0"]).toBe(180);
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial);
  });
  it("retains exact v3 and previous v2 classroom scenes with no readonly edit handles", async () => {
    for (const label of ["four-layer-circle", "v2-readable"]) {
      const entry = planePaperLayersCases().find((item) => item.label === label)!;
      const saved = parseToolScene(entry.scene), initial = entry.scene.payload.initial;
      const update = { toolId: "plane-folding", contentVersion: entry.scene.contentVersion, state: planarSnapshot(initial) } as ClassroomToolUpdate;
      const event = createClassroomToolState("page", "doc", "instance", update, toolSceneOriginHash(saved.payload));
      expect(parseClassroomToolState(event)).toEqual(event);
      await render({ toolId: "plane-folding", initial, readOnly: true, classroom: { state: planarSnapshot(initial) } });
      expect(current()).toEqual(initial); expect(container.querySelector("[data-paper-handle]")).toBeNull();
      if (label === "four-layer-circle") expect(button("慢慢展开一层").disabled).toBe(true);
    }
  });
});

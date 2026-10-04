// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanarWorkbench } from "@/features/tools/planar-kit/PlanarWorkbench";
import { planarSnapshot, type PlanarState } from "@/features/tools/planar-kit/contract";
import { arrangeCircleSectors, createCircleDissectionState, sectorPose, selectSector } from "@/features/tools/plane-circle-dissection/model";
import { createPolygonWorkbenchState } from "@/features/tools/plane-polygons/model";
import { createClassroomToolState, parseClassroomToolState, type ClassroomToolUpdate } from "@/features/tools/courseware/tool-classroom";
import { parseToolScene, toolSceneSchema } from "@/features/tools/scenes/contract";
import { toolSceneOriginHash } from "@/features/tools/scenes/classroom-envelope";
import { planePolygonWorkbenchCases } from "./fixtures/plane-polygons-open-cases";

vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
let container: HTMLDivElement, root: Root;
const capture = vi.fn<(state: PlanarState | null) => void>(), current = () => capture.mock.calls.at(-1)?.[0];
const button = (name: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const svg = () => container.querySelector<SVGSVGElement>("svg[viewBox='0 0 960 720']")!;
const render = async (props: Partial<ComponentProps<typeof PlanarWorkbench>> = {}) => {
  await act(async () => root.render(createElement(PlanarWorkbench, { toolId: "plane-circle-area", locale: "zh", onSnapshot: capture, ...props })));
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

describe("circle and polygon shared integration", () => {
  it("directly moves an unselected sector, cancels a second pointer and records one undo", async () => {
    const initial = createCircleDissectionState(); await render({ initial });
    const body = () => container.querySelector('[data-circle-sector="2"] > path')!;
    await pointer(body(), "pointerdown", 340, 380); await pointer(svg(), "pointermove", 440, 430); expect(current()).toBeNull();
    await pointer(svg(), "pointerup", 440, 430); const moved = current()!;
    expect(sectorPose(moved, 2)).toEqual({ x: 5.5, y: 1.5, angle: 45 }); expect(sectorPose(moved, 1)).toEqual(sectorPose(initial, 1));
    await pointer(body(), "pointerdown", 440, 430); await pointer(svg(), "pointermove", 500, 470);
    await pointer(svg(), "pointerdown", 550, 490, 2, false); expect(current()).toEqual(moved);
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial);
  });
  it("preserves irrational row coordinates on blur and shows rotation handles only for the operation", async () => {
    const initial = selectSector(arrangeCircleSectors(createCircleDissectionState(), "rows"), "sector.5"); await render({ initial });
    const body = container.querySelector('[data-circle-sector="5"] > path')!;
    await pointer(body, "pointerdown", 330, 430); await pointer(svg(), "pointerup", 330, 430);
    expect(container.querySelector("[data-circle-turn-handle]")).toBeNull();
    await act(async () => button("圆片的准确位置与方向").click());
    expect(container.querySelector("[data-circle-turn-handle]")).not.toBeNull();
    const x = container.querySelector<HTMLInputElement>('input[aria-label="圆心顶点 X（u）"]')!;
    await act(async () => x.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))); expect(sectorPose(current()!, 5)).toEqual(sectorPose(initial, 5));
    await act(async () => { x.value = "3.125"; x.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(sectorPose(current()!, 5)?.x).toBe(3.125);
    await act(async () => button("关闭面板").click()); expect(container.querySelector("[data-circle-turn-handle]")).toBeNull(); expect(sectorPose(current()!, 5)?.x).toBe(3.125);
  });
  it("freezes new circle and polygon scenes for classroom use and retains read-only state", async () => {
    for (const [toolId, contentVersion, initial] of [["plane-circle-area", "plane-circle-area-lesson-v2", createCircleDissectionState()], ["plane-polygons", "plane-polygons-lesson-v2", createPolygonWorkbenchState()]] as const) {
      const saved = parseToolScene({ toolId, contentVersion, payload: { title: "Prepared geometry", initial } });
      const update = { toolId, contentVersion, state: planarSnapshot(initial) } as ClassroomToolUpdate;
      const event = createClassroomToolState("page", "doc", "instance", update, toolSceneOriginHash(saved.payload));
      expect(parseClassroomToolState(event)).toEqual(event);
      await render({ toolId, version: contentVersion, initial, readOnly: true }); expect(current()).toEqual(initial);
      expect(container.querySelector('[aria-label="教学现场"]')).toBeNull();
      const target = container.querySelector<SVGElement>('svg[viewBox="0 0 960 720"] [role="button"]')!;
      await pointer(target, "pointerdown", 300, 350); await pointer(svg(), "pointermove", 400, 450); await pointer(svg(), "pointerup", 400, 450);
      expect(current()).toEqual(initial);
    }
  });
  it("routes all polygon fixtures through the real shared schema and current host", async () => {
    for (const entry of planePolygonWorkbenchCases()) expect(toolSceneSchema.safeParse(entry.scene).success, entry.label).toBe(entry.accepted);
    await render({ toolId: "plane-polygons" }); expect(current()?.sceneId).toBe("06-create");
    expect(container.querySelectorAll("[data-polygon-material]")).toHaveLength(2);
  });
});

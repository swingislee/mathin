// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanarWorkbench } from "@/features/tools/planar-kit/PlanarWorkbench";
import { planarToolbarFootprint } from "@/features/tools/planar-kit/PlanarObjectToolbar";
import { resolvePlanarContextActions } from "@/features/tools/planar-kit/context-actions";
import { planarScene } from "@/features/tools/planar-kit/scene-registry";
import { constructionObjects } from "@/features/tools/plane-construction/model";
import { planarSnapshot, type PlanarState } from "@/features/tools/planar-kit/contract";
import type { PlanarSceneDefinition } from "@/features/tools/planar-kit/types";

vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
const definition = planarScene("01-create");
const original = { contextActions: definition.contextActions, referenceGrid: definition.referenceGrid };
const bounds = { minX: 260, minY: 240, maxX: 600, maxY: 480 };
let container: HTMLDivElement, root: Root;
const capture = vi.fn<(state: PlanarState | null) => void>();
const current = () => capture.mock.calls.at(-1)?.[0];
const context = () => container.querySelector<HTMLElement>("[data-spatial-context-actions]");
const selectShape = async () => {
  const shape = container.querySelector('svg[viewBox="0 0 960 720"] [role="button"]')!;
  await act(async () => shape.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  capture.mockClear();
  definition.contextActions = () => ({ bounds, items: [{ kind: "operation", id: "rotate" }, { kind: "action", id: "construction-duplicate" }] });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 960, bottom: 720, width: 960, height: 720, toJSON: () => ({}) });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(260);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(44);
  Object.defineProperty(SVGSVGElement.prototype, "getScreenCTM", { configurable: true, value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  definition.contextActions = original.contextActions; definition.referenceGrid = original.referenceGrid;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function render(readOnly = false) {
  await act(async () => root.render(createElement(PlanarWorkbench, { toolId: "plane-shapes", locale: "zh", initial: definition.create(), readOnly, onSnapshot: capture })));
}

describe("shared planar object actions", () => {
  it("resolves the same existing callbacks, drops stale IDs and requires a live selection", () => {
    const state = definition.create();
    const result = resolvePlanarContextActions(definition, state, "object.1")!;
    expect(result.items[0].item).toBe(definition.operations?.find((item) => item.id === "rotate"));
    expect(result.items[1].item).toBe(definition.actions?.find((item) => item.id === "construction-duplicate"));
    expect(resolvePlanarContextActions(definition, state, null)).toBeNull();
    const stale: PlanarSceneDefinition = { ...definition, contextActions: () => ({ bounds, items: [{ kind: "action", id: "missing" }] }) };
    expect(resolvePlanarContextActions(stale, state, "object.1")).toBeNull();
    expect(resolvePlanarContextActions({ ...stale, contextActions: () => ({ bounds: { ...bounds, minX: NaN }, items: [] }) }, state, "object.1")).toBeNull();
  });
  it("maps actual SVG scaling and letterboxing without changing mathematical coordinates", () => {
    expect(planarToolbarFootprint({ minX: 100, minY: 200, maxX: 300, maxY: 400 }, { a: 0.5, b: 0, c: 0, d: 0.5, e: 100, f: 50 }, { left: 20, top: 10 }))
      .toEqual({ left: 116, top: 126, right: 244, bottom: 254 });
  });
  it("shares operations and undo with the sidebar, and blank/Escape clears only local selection", async () => {
    await render(); expect(context()).toBeNull();
    await selectShape();
    expect(container.querySelector<HTMLElement>("[data-planar-object-toolbar]")!.style.visibility).toBe("visible");
    const rotate = () => context()!.querySelector<HTMLButtonElement>('[data-spatial-action="rotate"]')!;
    await act(async () => rotate().click()); expect(rotate().getAttribute("aria-pressed")).toBe("true");
    await act(async () => rotate().click()); expect(rotate().getAttribute("aria-pressed")).toBe("false");
    await act(async () => context()!.querySelector<HTMLButtonElement>('[data-spatial-action="duplicate"]')!.click());
    expect(constructionObjects(current()!).length).toBe(2);
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="撤销"]')!.click());
    expect(constructionObjects(current()!).length).toBe(1);
    await act(async () => container.querySelector('svg[viewBox="0 0 960 720"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(context()).toBeNull(); expect(constructionObjects(current()!).length).toBe(1);
    await selectShape();
    await act(async () => context()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(context()).toBeNull(); expect(constructionObjects(current()!).length).toBe(1);
  });
  it("hides writable actions in read-only and classroom viewer instances", async () => {
    await render(); await selectShape(); expect(context()).not.toBeNull();
    await render(true); expect(context()).toBeNull();
    const initial = definition.create();
    await act(async () => root.render(createElement(PlanarWorkbench, { toolId: "plane-shapes", initial, classroom: { state: planarSnapshot(initial) } })));
    await selectShape(); expect(context()).toBeNull();
  });
  it("disables the same object actions while a classroom write is pending", async () => {
    await render(); await selectShape();
    let complete: (() => void) | undefined;
    const onChange = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
    const initial = definition.create();
    await act(async () => root.render(createElement(PlanarWorkbench, { toolId: "plane-shapes", initial, classroom: { state: planarSnapshot(initial), onChange } })));
    await act(async () => context()!.querySelector<HTMLButtonElement>('[data-spatial-action="duplicate"]')!.click());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect([...context()!.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
    await act(async () => context()!.querySelector<HTMLButtonElement>('[data-spatial-action="duplicate"]')!.click());
    expect(onChange).toHaveBeenCalledTimes(1);
    await act(async () => complete!());
  });
  it("lets mathematical grids replace the host reference grid", async () => {
    definition.referenceGrid = false;
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="显示设置"]')!.click());
    expect(container.textContent).not.toContain("参考网格");
    expect(container.querySelector('rect[fill^="url(#"]')).toBeNull();
  });
});

// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpatialToolState } from "@/features/tools/spatial-interaction/useSpatialToolState";
import { bindSpatialPointerGuard } from "@/features/spatial-math/renderer-r3f/spatial-pointer-guard";
import { beginSpatialObjectGesture } from "@/features/spatial-math/renderer-r3f/spatial-object-gesture";

const cleanups: (() => Promise<void>)[] = [];
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllGlobals(); });
async function setup() {
  const clear = vi.fn(), host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  function Workbench() {
    const controls = useSpatialToolState({ defaultTool: "orbit", panels: { move: "move" }, onClearSelection: clear });
    return createElement("section", { ...controls.bindings, "data-active": String(controls.selectionActive) },
      createElement("canvas", { onClick: (event) => controls.onPointerMissed(event.nativeEvent) }),
      createElement("button", { onClick: () => { controls.activateSelection(); controls.setPanel("move"); } }, "Select"),
      createElement("input"));
  }
  await act(async () => root.render(createElement(Workbench)));
  const canvas = host.querySelector("canvas")!, section = host.querySelector("section")!, input = host.querySelector("input")!;
  const release = bindSpatialPointerGuard(canvas);
  const pointer = (type: string, x: number, id = 1, button = 0) => canvas.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 10, button }), { pointerId: id }));
  const click = () => canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  cleanups.push(async () => { release(); await act(async () => root.unmount()); host.remove(); });
  return { canvas, section, input, clear, pointer, click, active: () => section.dataset.active === "true", select: async () => act(async () => host.querySelector("button")!.click()) };
}
describe("shared spatial selection lifecycle", () => {
  it("deselects on taps and workspace Escape, with no cross-instance or input interference", async () => {
    const a = await setup(), b = await setup();
    await act(async () => { a.pointer("pointerdown", 10); a.pointer("pointerup", 10); a.click(); });
    expect(a.active()).toBe(false); expect(b.active()).toBe(true); expect(a.clear).toHaveBeenCalledTimes(1);
    await a.select(); expect(a.active()).toBe(true);
    await act(async () => a.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(a.active()).toBe(true);
    await act(async () => a.section.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(a.active()).toBe(false); expect(a.section.dataset.spatialTool).toBe("orbit"); expect(b.clear).not.toHaveBeenCalled();
  });
  it("keeps selection through orbit-and-return, object claims, pinch, cancellation and right-click", async () => {
    const a = await setup();
    await act(async () => {
      a.pointer("pointerdown", 10); a.pointer("pointermove", 100); a.pointer("pointermove", 10); a.pointer("pointerup", 10); a.click();
      a.pointer("pointerdown", 10); beginSpatialObjectGesture(a.canvas); a.pointer("pointerup", 10); a.click();
      a.pointer("pointerdown", 10); a.pointer("pointerdown", 50, 2); a.pointer("pointerup", 10); a.pointer("pointerup", 50, 2); a.click();
      a.pointer("pointerdown", 10); a.pointer("pointercancel", 10); a.click();
      a.pointer("pointerdown", 10, 1, 2); a.pointer("pointerup", 10, 1, 2); a.click();
    });
    expect(a.active()).toBe(true); expect(a.clear).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(a.section);
  });
});

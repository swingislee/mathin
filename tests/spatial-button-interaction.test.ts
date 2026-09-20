// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { reduceSpatialToolState, type SpatialToolDefinition } from "@/features/tools/spatial-interaction/tool-state";
import { bindSpatialPointerGuard } from "@/features/spatial-math/renderer-r3f/spatial-pointer-guard";
import { beginSpatialObjectGesture } from "@/features/spatial-math/renderer-r3f/spatial-object-gesture";

type Tool = "orbit" | "pan" | "face" | "cut";
type Panel = "paint" | "settings" | "cut";
const definition: SpatialToolDefinition<Tool, Panel> = { defaultTool: "orbit", panels: { paint: "face", settings: "orbit", cut: "cut" } };
describe("spatial button state contract", () => {
  it("toggles an operation off and makes panel close restore normal manipulation", () => {
    const active = reduceSpatialToolState({ tool: "orbit", panel: null }, { kind: "panel", panel: "paint", toggle: true }, definition);
    expect(active).toEqual({ tool: "face", panel: "paint" });
    expect(reduceSpatialToolState(active, { kind: "panel", panel: "paint", toggle: true }, definition)).toEqual({ tool: "orbit", panel: null });
    expect(reduceSpatialToolState(active, { kind: "close" }, definition)).toEqual({ tool: "orbit", panel: null });
  });
  it("never keeps a hidden paint/cut mode behind a settings or camera button", () => {
    expect(reduceSpatialToolState({ tool: "face", panel: "paint" }, { kind: "panel", panel: "settings" }, definition)).toEqual({ tool: "orbit", panel: "settings" });
    expect(reduceSpatialToolState({ tool: "cut", panel: "cut" }, { kind: "tool", tool: "pan", toggle: true }, definition)).toEqual({ tool: "pan", panel: null });
    expect(reduceSpatialToolState({ tool: "pan", panel: null }, { kind: "tool", tool: "pan", toggle: true }, definition)).toEqual({ tool: "orbit", panel: null });
  });
  it("allows domain confirmation to hide parameters explicitly and paper tools to return to folding", () => {
    expect(reduceSpatialToolState({ tool: "cut", panel: "cut" }, { kind: "hide-panel" }, definition)).toEqual({ tool: "cut", panel: null });
    expect(reduceSpatialToolState({ tool: "select", panel: "style" }, { kind: "close" }, { defaultTool: "fold", panels: { style: "select" } })).toEqual({ tool: "fold", panel: null });
  });
});

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); document.body.innerHTML = ""; });
function setup() {
  const canvas = document.createElement("canvas"); document.body.append(canvas);
  cleanups.push(bindSpatialPointerGuard(canvas));
  const action = vi.fn(); canvas.addEventListener("click", action);
  const pointer = (type: string, x: number, id = 1, button = 0) => canvas.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX: x, clientY: 10, pointerId: id, button }));
  const click = () => canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  return { canvas, action, pointer, click };
}
describe("shared canvas click ownership", () => {
  it("permits taps but rejects an orbit that returns to its starting point", () => {
    const { action, pointer, click } = setup();
    pointer("pointerdown", 10); pointer("pointerup", 11); click(); expect(action).toHaveBeenCalledTimes(1);
    pointer("pointerdown", 10); pointer("pointermove", 80); pointer("pointermove", 10); pointer("pointerup", 10); click(); expect(action).toHaveBeenCalledTimes(1);
    pointer("pointerdown", 10); pointer("pointerup", 10); click(); expect(action).toHaveBeenCalledTimes(2);
  });
  it("does not turn object captures, pinch gestures, or cancellation into clicks", () => {
    const { canvas, action, pointer, click } = setup();
    pointer("pointerdown", 10); beginSpatialObjectGesture(canvas); pointer("pointerup", 10); click();
    pointer("pointerdown", 10); pointer("pointerdown", 40, 2); pointer("pointerup", 10); pointer("pointerup", 40, 2); click();
    pointer("pointerdown", 10); pointer("pointercancel", 10); click();
    pointer("pointerdown", 10, 1, 2); pointer("pointerup", 10, 1, 2); click();
    expect(action).not.toHaveBeenCalled();
  });
  it("isolates separate courseware canvases", () => {
    const first = setup(), second = setup();
    first.pointer("pointerdown", 10); first.pointer("pointermove", 40); first.pointer("pointerup", 40); first.click();
    second.pointer("pointerdown", 10); second.pointer("pointerup", 10); second.click();
    expect(first.action).not.toHaveBeenCalled(); expect(second.action).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpatialParameterDrag } from "@/features/tools/spatial-interaction/useSpatialParameterDrag";

const three = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@react-three/fiber", () => ({ useThree: (selector: (state: unknown) => unknown) => selector(three.current) }));
type DragOptions = Parameters<typeof useSpatialParameterDrag<string>>[0];
type BeginDrag = ReturnType<typeof useSpatialParameterDrag<string>>;
const bridge: { begin?: BeginDrag } = {};
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number; readonly pointerType: string; readonly isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? "mouse"; this.isPrimary = init.isPrimary ?? true;
  }
}
function Harness(props: DragOptions) {
  const begin = useSpatialParameterDrag(props);
  useLayoutEffect(() => { bridge.begin = begin; }, [begin]);
  return null;
}
let root: Root, host: HTMLDivElement, canvas: HTMLCanvasElement, mounted = false;
let options: DragOptions, source = 0.65;
const captures = new Set<number>(), hitEvents = new WeakSet<Event>();
const controls = { enabled: true }, cameraDown = vi.fn(), gestureStart = vi.fn();
const project = (value: number) => ({ x: value * 1000, y: 50 });
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("PointerEvent", TestPointerEvent);
  controls.enabled = true; source = 0.65; captures.clear(); cameraDown.mockClear(); gestureStart.mockClear();
  canvas = document.createElement("canvas"); host = document.createElement("div"); document.body.append(canvas, host);
  canvas.setPointerCapture = (id) => captures.add(id);
  canvas.hasPointerCapture = (id) => captures.has(id);
  canvas.releasePointerCapture = (id) => { if (captures.delete(id)) canvas.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: id })); };
  const state = { gl: { domElement: canvas }, controls, get: () => state }; three.current = state;
  options = { enabled: true, onPreview: vi.fn(), onCommit: vi.fn(), onDragging: vi.fn() };
  root = createRoot(host); mounted = true;
  await act(async () => root.render(createElement(Harness, options)));
  // 模拟 R3F 只在命中纸面的 onPointerDown 调用 begin；空白不调用域入口。
  canvas.addEventListener("pointerdown", (event) => { if (hitEvents.has(event)) bridge.begin!("side", event, source, project); });
  canvas.addEventListener("pointerdown", (event) => { if (controls.enabled) cameraDown(event); });
  canvas.addEventListener("mathin:spatial-object-gesture-start", gestureStart);
});
afterEach(async () => { if (mounted) await act(async () => root.unmount()); canvas.remove(); host.remove(); vi.unstubAllGlobals(); });
async function send(type: string, init: PointerEventInit = {}, hit = false) {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: 700, clientY: 80, ...init });
  if (hit) hitEvents.add(event);
  await act(async () => canvas.dispatchEvent(event)); return event;
}
async function rerender(patch: Partial<DragOptions>) { options = { ...options, ...patch }; await act(async () => root.render(createElement(Harness, options))); }
async function startAndPreview(pointerType = "mouse") {
  await send("pointerdown", { pointerType }, true);
  await send("pointermove", { pointerType, clientX: 800 });
  expect(options.onPreview).toHaveBeenLastCalledWith("side", 0.75);
}

describe("shared non-rigid parameter pointer lifecycle", () => {
  it("leaves blank presses and camera drags alone, claiming only an actual paper hit", async () => {
    const down = await send("pointerdown"), move = await send("pointermove", { clientX: 850 }); await send("pointerup", { clientX: 850 });
    expect(down.defaultPrevented).toBe(false); expect(move.defaultPrevented).toBe(false);
    expect(cameraDown).toHaveBeenCalledTimes(1); expect(gestureStart).not.toHaveBeenCalled(); expect(options.onDragging).not.toHaveBeenCalled(); expect(options.onCommit).not.toHaveBeenCalled();
    await send("pointerdown", {}, true);
    expect(gestureStart).toHaveBeenCalledTimes(1); expect(controls.enabled).toBe(false); expect(captures.has(1)).toBe(true);
    expect(cameraDown).toHaveBeenCalledTimes(1);
  });
  it.each(["mouse", "touch"])("%s starts from the grabbed material point, preserves its offset and commits one exact endpoint", async (pointerType) => {
    await startAndPreview(pointerType);
    // 起点的材料投影 x=650 而指针 x=700；沿手势 100px 后应为0.75，不是0或0.8。
    expect(options.onCommit).not.toHaveBeenCalled(); expect(controls.enabled).toBe(false);
    await send("pointermove", { pointerType, clientX: 850 });
    expect(options.onPreview).toHaveBeenLastCalledWith("side", 0.8);
    await send("pointerup", { pointerType, clientX: 850 }); await send("pointerup", { pointerType, clientX: 850 });
    expect(options.onCommit).toHaveBeenCalledTimes(1); expect(options.onCommit).toHaveBeenCalledWith("side", 0.8);
    expect(options.onDragging).toHaveBeenLastCalledWith(false); expect(controls.enabled).toBe(true); expect(captures.size).toBe(0);
  });
  it("does not turn a tap or sub-threshold movement into a parameter change", async () => {
    await send("pointerdown", {}, true); await send("pointermove", { clientX: 701 }); await send("pointerup", { clientX: 701 });
    expect(options.onCommit).not.toHaveBeenCalled(); expect(options.onPreview).toHaveBeenCalledExactlyOnceWith("side", null);
    expect(controls.enabled).toBe(true); expect(options.onDragging).toHaveBeenLastCalledWith(false);
  });
  it.each(["cancel", "Escape", "blur", "lostcapture", "disable", "unmount"])("%s restores the authoritative frame, releases capture and never publishes the preview", async (reason) => {
    await startAndPreview(); const preview = options.onPreview, commit = options.onCommit, dragging = options.onDragging;
    if (reason === "cancel") await send("pointercancel");
    if (reason === "Escape") await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    if (reason === "blur") await act(async () => window.dispatchEvent(new Event("blur")));
    if (reason === "lostcapture") await send("lostpointercapture");
    if (reason === "disable") await rerender({ enabled: false });
    if (reason === "unmount") { await act(async () => root.unmount()); mounted = false; }
    expect(preview).toHaveBeenLastCalledWith("side", null); expect(commit).not.toHaveBeenCalled(); expect(dragging).toHaveBeenLastCalledWith(false);
    expect(controls.enabled).toBe(true); expect(captures.size).toBe(0);
    await send("pointerup", { clientX: 800 }); expect(commit).not.toHaveBeenCalled();
  });
  it("callback identity and parent rerenders preserve the captured start and use the latest callbacks", async () => {
    await startAndPreview(); const firstPreview = options.onPreview, firstCommit = options.onCommit;
    const latest = { onPreview: vi.fn(), onCommit: vi.fn(), onDragging: vi.fn() };
    source = 0; await rerender(latest);
    expect(firstPreview).not.toHaveBeenLastCalledWith("side", null); expect(captures.has(1)).toBe(true); expect(controls.enabled).toBe(false);
    await send("pointermove", { clientX: 850 }); expect(latest.onPreview).toHaveBeenLastCalledWith("side", 0.8);
    await send("pointerup", { clientX: 850 });
    expect(firstCommit).not.toHaveBeenCalled(); expect(latest.onCommit).toHaveBeenCalledExactlyOnceWith("side", 0.8);
    expect(latest.onDragging).toHaveBeenLastCalledWith(false);
  });
  it.each([false, true])("a second touch hands control back to the camera (paper already moved: %s)", async (moved) => {
    await send("pointerdown", { pointerType: "touch" }, true);
    if (moved) await send("pointermove", { pointerType: "touch", clientX: 800 });
    const second = await send("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: false }, true);
    expect(second.defaultPrevented).toBe(false); expect(controls.enabled).toBe(true); expect(captures.size).toBe(0);
    expect(options.onPreview).toHaveBeenLastCalledWith("side", null); expect(options.onCommit).not.toHaveBeenCalled();
    expect(cameraDown).toHaveBeenLastCalledWith(second);
    await send("pointerup", { pointerType: "touch", clientX: 800 }); expect(options.onCommit).not.toHaveBeenCalled();
  });
  it("ignores non-primary, right-button and disabled object attempts", async () => {
    await send("pointerdown", { isPrimary: false }, true); await send("pointerup", { isPrimary: false });
    await send("pointerdown", { button: 2 }, true); await send("pointerup", { button: 2 });
    await rerender({ enabled: false }); await send("pointerdown", {}, true);
    expect(options.onDragging).not.toHaveBeenCalled(); expect(options.onPreview).not.toHaveBeenCalled(); expect(gestureStart).not.toHaveBeenCalled(); expect(captures.size).toBe(0);
  });
  it("restores the prior disabled-camera state and ignores another pointer's cancellation", async () => {
    controls.enabled = false; await startAndPreview();
    await send("pointercancel", { pointerId: 8 }); expect(captures.has(1)).toBe(true);
    await send("pointercancel"); expect(controls.enabled).toBe(false); expect(captures.size).toBe(0); expect(options.onCommit).not.toHaveBeenCalled();
  });
});

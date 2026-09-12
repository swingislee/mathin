import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasSurface, type CanvasSurfaceInputPort } from "@/features/whiteboard/CanvasSurface";
import { createWhiteboardStore, type WhiteboardStore } from "@/features/whiteboard/store";
import { BoardBus } from "@/features/whiteboard/bus";
import type { EraserTool, StrokeItem } from "@/features/whiteboard/types";

const lifecycle = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)>, cleanups: [] as Array<() => void> }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(), useId: () => "palm-canvas", useRef: (current: unknown) => ({ current }),
  useState: (current: unknown) => [current, vi.fn()], useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => void | (() => void)) => { lifecycle.effects.push(fn); },
}));
vi.mock("zustand", async (original) => ({
  ...await original<typeof import("zustand")>(),
  useStore: (store: WhiteboardStore, selector: (state: ReturnType<WhiteboardStore["getState"]>) => unknown) => selector(store.getState()),
}));

interface Props { children?: ReactNode; ref?: { current: unknown } }
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}

function harness(inputMode: "smart" | "ink-lock" = "smart", tool: "pen" | "pointer" = "pen", lastEraser: EraserTool = "eraserM") {
  const createContext = () => ({ setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    beginPath: vi.fn(), arc: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), globalCompositeOperation: "source-over", fillStyle: "" });
  class Surface extends EventTarget {
    clientWidth = 400; clientHeight = 300; width = 400; height = 300; dataset = {}; captures = new Set<number>();
    context = createContext();
    getContext() { return this.context; }
    getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 400, height: 300 }));
    setPointerCapture(id: number) { this.captures.add(id); }
    hasPointerCapture(id: number) { return this.captures.has(id); }
    releasePointerCapture(id: number) { this.captures.delete(id); }
  }
  const doc = Object.assign(new EventTarget(), { documentElement: new Surface(), visibilityState: "visible" });
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  const host = Object.assign(new EventTarget(), { devicePixelRatio: 1, matchMedia: () => new EventTarget(),
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; }),
    cancelAnimationFrame: vi.fn((id: number) => frames.delete(id)) });
  vi.stubGlobal("window", host); vi.stubGlobal("document", doc);
  const computedStyle = vi.fn(() => ({ getPropertyValue: () => "#111" }));
  vi.stubGlobal("getComputedStyle", computedStyle);
  vi.stubGlobal("Path2D", class {});
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
  // 局域网 HTTP 的 UUID 兜底同样参与本次绘制。
  vi.stubGlobal("crypto", { getRandomValues: (array: Uint8Array) => { array.fill(7); return array; } });
  const store = createWhiteboardStore(); store.setState({ tool, color: "rose", sizeNorm: 0.004, lastEraser });
  const bus = new BoardBus(), progress = vi.fn(); bus.on("local-progress-start", progress);
  let port: CanvasSurfaceInputPort | null = null;
  const tree = CanvasSurface({ editable: true, store, bus, strokeWidthBasis: 1000, inputMode, renderProfile: "classroom", onInputPort: (next) => { port = next; } });
  const nodes: Surface[] = [];
  for (const element of elements(tree)) if (element.props.ref) { const node = new Surface(); element.props.ref.current = node; nodes.push(node); }
  for (const effect of lifecycle.effects.splice(0)) { const cleanup = effect(); if (cleanup) lifecycle.cleanups.push(cleanup); }
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(0)); };
  return { port: port as CanvasSurfaceInputPort | null, store, host, context: nodes[1].context, draftContext: nodes[2].context,
    progress, draft: nodes[2], flush, computedStyle };
}

afterEach(() => { lifecycle.cleanups.splice(0).reverse().forEach((cleanup) => cleanup()); lifecycle.effects = []; vi.unstubAllGlobals(); });

describe("temporary palm eraser through the real canvas input port", () => {
  it("commits one synchronized undoable erase stroke and restores the same pen settings", () => {
    const h = harness();
    h.context.clearRect.mockClear();
    expect(h.port!.begin(1, [0.2, 0.3], { eraserWidth: 0.2 })).toBe(true);
    h.port!.append(1, [[0.4, 0.3]]); h.port!.finish(1, [[0.6, 0.3]]);
    const erase = h.store.getState().items[0];
    expect(erase).toMatchObject({ mode: "erase", color: "rose", wNorm: 0.08, points: [[0.2, 0.3], [0.4, 0.3], [0.6, 0.3]] });
    expect(h.store.getState().outbox).toContainEqual(expect.objectContaining({ t: "commit", item: erase }));
    expect(h.progress).not.toHaveBeenCalled();
    expect(h.context.globalCompositeOperation).toBe("destination-out");
    // 收笔从底图重放一次，擦除预览的边缘不会再次叠擦。
    expect(h.context.clearRect).toHaveBeenCalledOnce();
    expect(h.store.getState()).toMatchObject({ tool: "pen", color: "rose", sizeNorm: 0.004 });
    h.store.getState().undo();
    expect(h.store.getState().items).toEqual([]);
    expect(h.store.getState().outbox).toContainEqual(expect.objectContaining({ t: "erase", id: erase.id }));
    h.port!.begin(2, [0.5, 0.5]); h.port!.finish(2, [[0.7, 0.5]]);
    expect(h.store.getState().items[0]).toMatchObject({ mode: "ink", color: "rose", wNorm: 0.004 });
  });

  it("discards a palm on cancellation, lifecycle interruption, and direct-canvas capture transfer", () => {
    const h = harness("ink-lock");
    h.port!.begin(1, [0.2, 0.3], { eraserWidth: 0.2 });
    h.port!.append(1, [[0.4, 0.3]]);
    h.draft.dispatchEvent(Object.assign(new Event("lostpointercapture"), { pointerId: 1 }));
    expect(h.store.getState().items).toEqual([]);
    expect(h.port!.cancel(1)).toBe(true);
    h.port!.begin(2, [0.2, 0.3], { eraserWidth: 0.2 }); h.port!.append(2, [[0.4, 0.3]]);
    h.host.dispatchEvent(new Event("blur"));
    expect(h.store.getState().items).toEqual([]);
    expect(h.store.getState().outbox).toEqual([]);
    expect(h.port!.finish(2)).toBe(false);
  });

  it("does not expose a drawing port in pointer mode and rejects invalid temporary widths", () => {
    expect(harness("smart", "pointer").port).toBeNull();
    const h = harness();
    expect(h.port!.begin(1, [0.2, 0.3], { eraserWidth: NaN })).toBe(false);
    expect(h.port!.begin(1, [0.2, 0.3], { eraserWidth: 2 })).toBe(false);
    expect(h.store.getState().outbox).toEqual([]);
  });

  it("follows the remembered whole-stroke eraser, sweeps gaps, and undoes the gesture once", () => {
    const h = harness("ink-lock", "pen", "strokeEraser");
    const vertical = (id: string, x: number): StrokeItem => ({ id, mode: "ink", brush: "round-v1", color: "blue", wNorm: 0.004, points: [[x, 0.1], [x, 0.9]] });
    const items = [vertical("one", 0.35), vertical("two", 0.65), vertical("outside", 0.95)];
    h.store.getState().replaceItems(items);
    h.port!.begin(1, [0.1, 0.5], { eraserWidth: 0.1 });
    h.port!.append(1, [[0.8, 0.5]]); h.flush();
    expect(h.store.getState().items).toEqual(items);
    expect(h.store.getState().outbox).toEqual([]);
    h.port!.finish(1);
    expect(h.store.getState().items.map((item) => item.id)).toEqual(["outside"]);
    expect(h.store.getState().outbox).toEqual([{ t: "erase", id: "one" }, { t: "erase", id: "two" }]);
    expect(h.store.getState().undoStack).toHaveLength(1);
    h.store.getState().undo();
    expect(h.store.getState().items).toEqual(items);
    expect(h.store.getState()).toMatchObject({ tool: "pen", lastEraser: "strokeEraser" });
  });

  it("previews whole-stroke erasing immediately and restores it on cancellation", () => {
    const h = harness("ink-lock", "pen", "strokeEraser");
    const item: StrokeItem = { id: "dot", mode: "ink", color: "ink", wNorm: 0.004, points: [[0.5, 0.5]] };
    h.store.getState().replaceItems([item]);
    h.context.fill.mockClear(); h.context.clearRect.mockClear();
    h.port!.begin(1, [0.5, 0.5], { eraserWidth: 0.1 });
    expect(h.context.clearRect).toHaveBeenCalledOnce();
    expect(h.context.fill).not.toHaveBeenCalled();
    h.port!.cancel(1);
    expect(h.context.fill).toHaveBeenCalledOnce();
    expect(h.store.getState().items).toEqual([item]);
    expect(h.store.getState().outbox).toEqual([]);
  });
});

describe("classroom ink input and base painting", () => {
  it("paints the first dot before a frame or movement and commits the same round brush", () => {
    const h = harness();
    h.port!.begin(1, [0.2, 0.3]);
    expect(h.draftContext.arc).toHaveBeenCalledWith(80, 90, 2, 0, Math.PI * 2);
    expect(h.host.requestAnimationFrame).not.toHaveBeenCalled();
    h.port!.finish(1);
    expect(h.context.arc).toHaveBeenLastCalledWith(80, 90, 2, 0, Math.PI * 2);
    expect(h.store.getState().items[0]).toMatchObject({ brush: "round-v1", points: [[0.2, 0.3]] });
  });

  it("draws every back-to-back commit even without a React render, including reentrant outbox draining", () => {
    const h = harness();
    const unsubscribe = h.store.subscribe((state) => { if (state.outbox.length) state.drainOutbox(); });
    for (const id of ["one", "two"]) h.store.getState().commitItem({ id, mode: "ink", brush: "round-v1", color: "ink", wNorm: 0.004, points: [[0.1, 0.1], [0.3, 0.4]] });
    expect(h.store.getState().items).toHaveLength(2);
    expect(h.context.stroke).toHaveBeenCalledTimes(2);
    h.store.getState().undo();
    expect(h.context.stroke).toHaveBeenCalledTimes(3);
    h.store.getState().clear();
    const clearedAt = h.context.clearRect.mock.invocationCallOrder.at(-1)!;
    h.store.getState().commitItem({ id: "after-clear", mode: "ink", brush: "round-v1", color: "ink", wNorm: 0.004, points: [[0, 0], [0.5, 0.5]] });
    expect(h.store.getState().items.map((item) => item.id)).toEqual(["after-clear"]);
    expect(h.context.stroke.mock.invocationCallOrder.at(-1)).toBeGreaterThan(clearedAt);
    unsubscribe();
  });

  it("reads layout once per coalesced event and paints only new segments to the latest endpoint", () => {
    const h = harness("ink-lock");
    const event = (type: string, x: number, extra = {}) => Object.assign(new Event(type), {
      pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: 90, ...extra,
    });
    h.draft.dispatchEvent(event("pointerdown", 80));
    h.draft.getBoundingClientRect.mockClear(); h.computedStyle.mockClear();
    h.draft.dispatchEvent(event("pointermove", 160, { getCoalescedEvents: () => Array.from({ length: 8 }, (_, index) => ({ clientX: 80 + index * 10, clientY: 90 })) }));
    h.flush();
    expect(h.draft.getBoundingClientRect).toHaveBeenCalledOnce();
    expect(h.computedStyle).not.toHaveBeenCalled();
    expect(h.draftContext.lineTo).toHaveBeenLastCalledWith(160, 90);
    h.draftContext.moveTo.mockClear(); h.draftContext.lineTo.mockClear();
    h.draft.dispatchEvent(event("pointermove", 180)); h.flush();
    expect(h.draftContext.moveTo).toHaveBeenCalledWith(160, 90);
    expect(h.draftContext.lineTo).toHaveBeenCalledExactlyOnceWith(180, 90);
    h.host.dispatchEvent(event("pointerup", 185));
    expect((h.store.getState().items[0] as StrokeItem).points.at(-1)).toEqual([185 / 400, 0.3]);
  });
});

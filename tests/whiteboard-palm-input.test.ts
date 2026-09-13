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

class RecordedPath {
  points: Array<[number, number]> = [];
  closed = false;
  constructor(readonly svg?: string) {}
  moveTo(x: number, y: number) { this.points.push([x, y]); }
  lineTo(x: number, y: number) { this.points.push([x, y]); }
  closePath() { this.closed = true; }
}

function harness(inputMode: "smart" | "ink-lock" = "smart", tool: "pen" | "pointer" = "pen", lastEraser: EraserTool = "eraserM") {
  const createContext = () => ({ setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), arc: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), globalCompositeOperation: "source-over", fillStyle: "" });
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
  const computedStyle = vi.fn(() => ({ getPropertyValue: (): string => "#111" }));
  vi.stubGlobal("getComputedStyle", computedStyle);
  vi.stubGlobal("Path2D", RecordedPath);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  let themeChange = () => {};
  vi.stubGlobal("MutationObserver", class { constructor(callback: () => void) { themeChange = callback; } observe() {} disconnect() {} });
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
    progress, draft: nodes[2], flush, computedStyle, themeChange };
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
  it("paints the first dot before a frame or movement and commits the same natural outline", () => {
    const h = harness();
    h.port!.begin(1, [0.2, 0.3]);
    const preview = h.draftContext.fill.mock.lastCall![0] as RecordedPath;
    expect(preview.points.length).toBeGreaterThan(0);
    expect(preview.closed).toBe(true);
    expect(h.host.requestAnimationFrame).not.toHaveBeenCalled();
    h.port!.finish(1);
    expect(h.context.fill).toHaveBeenLastCalledWith(preview);
    expect(h.store.getState().items[0]).toMatchObject({ brush: "freehand-v2", points: [[0.2, 0.3]], samples: [[0, null]] });
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

  it("keeps a pressure dot unchanged when pointerup supplies the same position and no contact pressure", () => {
    const h = harness();
    h.port!.begin(1, [0.2, 0.3, { timeStamp: 100, pressure: 0.2 }]);
    const preview = h.draftContext.fill.mock.lastCall![0];
    h.port!.finish(1, [[0.2, 0.3, { timeStamp: 120, pressure: null }]]);
    expect(h.context.fill.mock.lastCall![0]).toEqual(preview);
  });

  it("reuses gesture layout and replaces the active outline within its bounds without redrawing committed ink", () => {
    const h = harness("ink-lock");
    const event = (type: string, x: number, extra = {}) => Object.assign(new Event(type), {
      pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: 90, ...extra,
    });
    h.draft.dispatchEvent(event("pointerdown", 80));
    h.draft.getBoundingClientRect.mockClear(); h.computedStyle.mockClear(); h.draftContext.clearRect.mockClear();
    h.draft.dispatchEvent(event("pointermove", 160, { getCoalescedEvents: () => Array.from({ length: 8 }, (_, index) => ({ clientX: 80 + index * 10, clientY: 90 })) }));
    h.flush();
    expect(h.draft.getBoundingClientRect).not.toHaveBeenCalled();
    expect(h.computedStyle).not.toHaveBeenCalled();
    expect(h.draftContext.clearRect).toHaveBeenCalledOnce();
    h.draftContext.clearRect.mockClear(); h.draftContext.fill.mockClear();
    h.draft.dispatchEvent(event("pointermove", 180)); h.flush();
    expect(h.draftContext.clearRect).toHaveBeenCalledOnce();
    expect(h.draftContext.fill).toHaveBeenCalledOnce();
    const updatedOutline = h.draftContext.fill.mock.lastCall![0] as RecordedPath;
    expect(Math.min(...updatedOutline.points.map(([x]) => x))).toBeLessThan(80);
    expect(Math.max(...updatedOutline.points.map(([x]) => x))).toBeGreaterThan(180);
    expect(h.context.fill).not.toHaveBeenCalled();
    h.host.dispatchEvent(event("pointerup", 185));
    expect((h.store.getState().items[0] as StrokeItem).points.at(-1)).toEqual([185 / 400, 0.3]);
    expect(h.context.fill.mock.lastCall![0]).toEqual(h.draftContext.fill.mock.lastCall![0]);
  });

  it("captures coalesced pen pressure through direct input and invalidates layout on scrolling", () => {
    const h = harness("ink-lock");
    const event = (type: string, x: number, timeStamp: number, pressure: number, extra = {}) => {
      const result = Object.assign(new Event(type), { pointerId: 1, pointerType: "pen", isPrimary: true, button: 0,
        buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: 90, pressure, ...extra });
      Object.defineProperty(result, "timeStamp", { value: timeStamp });
      return result;
    };
    h.draft.dispatchEvent(event("pointerdown", 80, 100, 0.2));
    h.draft.getBoundingClientRect.mockClear();
    h.draft.dispatchEvent(event("pointermove", 300, 104, 0.9, { pointerId: 2 }));
    h.host.dispatchEvent(event("pointerup", 300, 104, 0, { pointerId: 2 }));
    expect(h.draft.getBoundingClientRect).not.toHaveBeenCalled();
    h.host.dispatchEvent(new Event("scroll"));
    h.draft.dispatchEvent(event("pointermove", 100, 116, 0.8, { getCoalescedEvents: () => [
      { clientX: 90, clientY: 90, timeStamp: 108, pressure: 0.4, buttons: 1, pointerType: "pen" },
      { clientX: 100, clientY: 90, timeStamp: 116, pressure: 0.8, buttons: 1, pointerType: "pen" },
    ] }));
    h.flush();
    h.host.dispatchEvent(event("pointerup", 105, 120, 0));
    expect(h.draft.getBoundingClientRect).toHaveBeenCalledOnce();
    const saved = h.store.getState().items[0] as StrokeItem;
    expect(saved.samples).toEqual([[0, 0.2], [8, 0.4], [16, 0.8], [20, 0.8]]);
    expect(saved.points).toEqual([[0.2, 0.3], [0.225, 0.3], [0.25, 0.3], [0.2625, 0.3]]);
    expect(h.context.fill.mock.lastCall![0]).toEqual(h.draftContext.fill.mock.lastCall![0]);
  });

  it("refreshes the cached active ink color when the theme changes", () => {
    const h = harness();
    h.port!.begin(1, [0.2, 0.3]);
    h.computedStyle.mockImplementation(() => ({ getPropertyValue: () => "#eee" }));
    h.themeChange();
    expect(h.draftContext.fillStyle).toBe("#eee");
    h.computedStyle.mockClear();
    h.port!.append(1, [[0.4, 0.3]]); h.flush();
    expect(h.computedStyle).not.toHaveBeenCalled();
    expect(h.draftContext.fillStyle).toBe("#eee");
  });
});

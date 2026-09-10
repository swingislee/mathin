import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasSurface, type CanvasSurfaceInputPort } from "@/features/whiteboard/CanvasSurface";
import { createWhiteboardStore, type WhiteboardStore } from "@/features/whiteboard/store";
import { BoardBus } from "@/features/whiteboard/bus";

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

function harness(inputMode: "smart" | "ink-lock" = "smart", tool: "pen" | "pointer" = "pen") {
  const context = { setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), fill: vi.fn(), globalCompositeOperation: "source-over", fillStyle: "" };
  class Surface extends EventTarget {
    clientWidth = 400; clientHeight = 300; width = 400; height = 300; dataset = {}; captures = new Set<number>();
    getContext() { return context; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300 }; }
    setPointerCapture(id: number) { this.captures.add(id); }
    hasPointerCapture(id: number) { return this.captures.has(id); }
    releasePointerCapture(id: number) { this.captures.delete(id); }
  }
  const doc = Object.assign(new EventTarget(), { documentElement: new Surface(), visibilityState: "visible" });
  const host = Object.assign(new EventTarget(), { devicePixelRatio: 1, matchMedia: () => new EventTarget(),
    requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn() });
  vi.stubGlobal("window", host); vi.stubGlobal("document", doc);
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "#111" }));
  vi.stubGlobal("Path2D", class {});
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
  // 局域网 HTTP 的 UUID 兜底同样参与本次绘制。
  vi.stubGlobal("crypto", { getRandomValues: (array: Uint8Array) => { array.fill(7); return array; } });
  const store = createWhiteboardStore(); store.setState({ tool, color: "rose", sizeNorm: 0.004 });
  const bus = new BoardBus(), progress = vi.fn(); bus.on("local-progress-start", progress);
  let port: CanvasSurfaceInputPort | null = null;
  const tree = CanvasSurface({ editable: true, store, bus, strokeWidthBasis: 1000, inputMode, onInputPort: (next) => { port = next; } });
  const nodes: Surface[] = [];
  for (const element of elements(tree)) if (element.props.ref) { const node = new Surface(); element.props.ref.current = node; nodes.push(node); }
  for (const effect of lifecycle.effects.splice(0)) { const cleanup = effect(); if (cleanup) lifecycle.cleanups.push(cleanup); }
  return { port: port as CanvasSurfaceInputPort | null, store, host, context, progress, draft: nodes[2] };
}

afterEach(() => { lifecycle.cleanups.splice(0).reverse().forEach((cleanup) => cleanup()); lifecycle.effects = []; vi.unstubAllGlobals(); });

describe("temporary palm eraser through the real canvas input port", () => {
  it("commits one synchronized undoable erase stroke and restores the same pen settings", () => {
    const h = harness();
    expect(h.port!.begin(1, [0.2, 0.3], { eraserWidth: 0.2 })).toBe(true);
    h.port!.append(1, [[0.4, 0.3]]); h.port!.finish(1, [[0.6, 0.3]]);
    const erase = h.store.getState().items[0];
    expect(erase).toMatchObject({ mode: "erase", color: "rose", wNorm: 0.08, points: [[0.2, 0.3], [0.4, 0.3], [0.6, 0.3]] });
    expect(h.store.getState().outbox).toContainEqual(expect.objectContaining({ t: "commit", item: erase }));
    expect(h.progress).not.toHaveBeenCalled();
    expect(h.context.globalCompositeOperation).toBe("destination-out");
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
});

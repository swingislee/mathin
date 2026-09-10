import { isValidElement, type ReactElement, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardObjectLayer } from "@/features/whiteboard/BoardObjectLayer";
import { InstrumentLayer } from "@/features/whiteboard/InstrumentLayer";
import { createWhiteboardStore, type WhiteboardStore } from "@/features/whiteboard/store";
import { createShapeFromDrag } from "@/features/whiteboard/geometry";

const effects = vi.hoisted(() => ({ cleanups: [] as Array<() => void> }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (value: unknown) => [value, vi.fn()],
  useRef: (value: unknown) => ({ current: value }),
  useEffect: (setup: () => void | (() => void)) => {
    const cleanup = setup();
    if (cleanup) effects.cleanups.push(cleanup);
  },
}));
vi.mock("zustand", async (original) => ({
  ...await original<typeof import("zustand")>(),
  useStore: (store: WhiteboardStore, selector: (state: ReturnType<WhiteboardStore["getState"]>) => unknown) => selector(store.getState()),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

interface Props {
  children?: ReactNode;
  className?: string;
  "data-classroom-input"?: string;
  onPointerDown?: (event: ReactPointerEvent<SVGElement>) => void;
}
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}

function pointerHarness(startX = 400, startY = 300) {
  const listeners = new Map<string, Map<(event: object) => void, boolean>>();
  const host = {
    addEventListener: (type: string, listener: (event: object) => void, options?: boolean | AddEventListenerOptions) => {
      if (!listeners.has(type)) listeners.set(type, new Map());
      listeners.get(type)!.set(listener, typeof options === "boolean" ? options : options?.capture ?? false);
    },
    removeEventListener: (type: string, listener: (event: object) => void) => listeners.get(type)?.delete(listener),
  };
  vi.stubGlobal("window", host);
  const owner = Object.assign(new EventTarget(), { defaultView: host, visibilityState: "visible" });
  const captured = new Set<number>();
  const target = Object.assign(new EventTarget(), {
    ownerDocument: owner,
    ownerSVGElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 750 }) },
    setPointerCapture: vi.fn((pointerId: number) => { captured.add(pointerId); }),
    hasPointerCapture: (pointerId: number) => captured.has(pointerId),
    releasePointerCapture: vi.fn((pointerId: number) => {
      captured.delete(pointerId);
      target.dispatchEvent(Object.assign(new Event("lostpointercapture"), { pointerId }));
    }),
  });
  const fire = (type: string, x: number, pointerId = 1, options: { buttons?: number; pointerType?: string; clientY?: number; stopAtTarget?: boolean } = {}) => {
    for (const [listener, capture] of [...listeners.get(type) ?? []]) {
      if (!capture && options.stopAtTarget) continue;
      listener({ type, pointerId, clientX: x, clientY: options.clientY ?? startY,
        pointerType: options.pointerType ?? "mouse", buttons: options.buttons ?? (type === "pointerup" ? 0 : 1), preventDefault: vi.fn() });
    }
  };
  const event = {
    pointerId: 1, isPrimary: true, button: 0, buttons: 1, pointerType: "mouse", clientX: startX, clientY: startY,
    nativeEvent: { clientX: startX, clientY: startY }, currentTarget: target,
    preventDefault: vi.fn(), stopPropagation: vi.fn(),
  } as unknown as ReactPointerEvent<SVGElement>;
  return { fire, event, target, owner, listenerCount: () => [...listeners.values()].reduce((count, bucket) => count + bucket.size, 0) };
}

afterEach(() => {
  effects.cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
});

describe("whiteboard object and instrument ownership", () => {
  it("lets the Smart pen move a shape without switching tools, and ignores other pointers", () => {
    const h = pointerHarness();
    const store = createWhiteboardStore();
    const shape = createShapeFromDrag("shape", "rectangle", [0.3, 0.3], [0.5, 0.5], "ink", null, 0.004);
    store.setState({ tool: "pen", items: [shape] });
    const target = elements(BoardObjectLayer({ store, editable: true, penInteraction: true, width: 1000, height: 750, preview: null }))
      .find((element) => element.props["data-classroom-input"] === "drag" && element.props.onPointerDown)!;
    target.props.onPointerDown!(h.event);
    h.fire("pointermove", 600, 2);
    h.fire("pointerup", 600, 2);
    h.fire("pointermove", 500);
    h.fire("pointerup", 500);
    expect(store.getState().items[0]).toMatchObject({ x: shape.x + 0.1 });
    expect(store.getState().tool).toBe("pen");
    expect(store.getState().outbox).toContainEqual(expect.objectContaining({ t: "replace" }));
  });

  it("keeps pen-only mode from selecting objects and cancels a Smart drag for a pinch", () => {
    const h = pointerHarness();
    const store = createWhiteboardStore();
    const shape = createShapeFromDrag("shape", "rectangle", [0.3, 0.3], [0.5, 0.5], "ink", null, 0.004);
    store.setState({ tool: "pen", items: [shape] });
    const layer = (penInteraction: boolean) => elements(BoardObjectLayer({ store, editable: true, penInteraction, width: 1000, height: 750, preview: null }))
      .find((element) => element.props["data-classroom-input"] === "drag" && element.props.onPointerDown)!;
    layer(false).props.onPointerDown!(h.event);
    expect(store.getState().selectedIds).toEqual([]);
    layer(true).props.onPointerDown!(h.event);
    h.fire("pointermove", 500);
    h.fire("pointercancel", 500);
    expect(store.getState().items).toEqual([shape]);
    expect(store.getState().outbox).toEqual([]);
  });

  it("keeps instrument movement available in pointer mode and removes all drawing handles", () => {
    const h = pointerHarness();
    const store = createWhiteboardStore();
    for (const kind of ["ruler", "compass", "protractor"] as const) store.getState().addInstrument(kind);
    const before = store.getState().instruments[0];
    const tree = elements(InstrumentLayer({ store, editable: true, drawingEnabled: false, width: 1000, height: 750 }));
    expect(tree.some((element) => element.props.className?.includes("cursor-crosshair"))).toBe(false);
    tree.find((element) => element.props.className === "cursor-move" && element.props.onPointerDown)!.props.onPointerDown!(h.event);
    h.fire("pointermove", 500);
    h.fire("pointerup", 500);
    expect(store.getState().instruments[0].x).toBeCloseTo(before.x + 0.1);
    expect(store.getState().items).toEqual([]);
  });

  it("draws through the ruler with a Smart pen and discards cancelled strokes", () => {
    const h = pointerHarness();
    const store = createWhiteboardStore();
    store.getState().addInstrument("ruler");
    const draw = () => elements(InstrumentLayer({ store, editable: true, width: 1000, height: 750 }))
      .find((element) => element.props.className === "cursor-crosshair")!.props.onPointerDown!(h.event);
    draw(); h.fire("pointermove", 500); h.fire("pointercancel", 500);
    expect(store.getState().items).toEqual([]);
    draw(); h.fire("pointermove", 500); h.fire("pointerup", 500);
    expect(store.getState().items).toHaveLength(1);
    expect(store.getState().items[0]).toMatchObject({ kind: "shape", shape: "line" });
  });

  it.each([false, true])("ends ruler resizing on release even when the target stops bubbling (drawing enabled: %s)", (drawingEnabled) => {
    const h = pointerHarness(740, 240);
    const store = createWhiteboardStore();
    store.getState().addInstrument("ruler");
    const before = store.getState().instruments[0];
    const resize = elements(InstrumentLayer({ store, editable: true, drawingEnabled, width: 1000, height: 750 }))
      .find((element) => element.props.className === "cursor-ew-resize")!.props.onPointerDown!;
    resize(h.event);
    expect(h.target.setPointerCapture).toHaveBeenCalledWith(1);
    h.fire("pointermove", 740);
    expect(store.getState().instruments[0].width).toBe(before.width);
    h.fire("pointermove", 790);
    expect(store.getState().instruments[0].width).toBeCloseTo(before.width + 0.1);
    h.fire("pointerup", 810, 1, { stopAtTarget: true });
    h.fire("pointermove", 950, 1, { buttons: 0 });
    expect(store.getState().instruments[0].width).toBeCloseTo(before.width + 0.14);
    expect(h.target.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(h.listenerCount()).toBe(0);
  });

  it("leaves a ruler unchanged after clicking and releasing the length handle", () => {
    const h = pointerHarness(740, 240);
    const store = createWhiteboardStore();
    store.getState().addInstrument("ruler");
    const before = store.getState().instruments[0];
    const resize = elements(InstrumentLayer({ store, editable: true, width: 1000, height: 750 }))
      .find((element) => element.props.className === "cursor-ew-resize")!.props.onPointerDown!;
    for (let click = 0; click < 3; click++) {
      resize(h.event);
      h.fire("pointerup", 740);
      h.fire("pointermove", 940, 1, { buttons: 0 });
      expect(store.getState().instruments).toEqual([before]);
    }
    expect(store.getState().items).toEqual([]);
  });

  it.each(["mouse", "pen"])("stops at the last held position when %s release is missed and capture is unavailable", (pointerType) => {
    const h = pointerHarness(740, 240);
    h.target.setPointerCapture.mockImplementation(() => { throw new Error("capture unavailable"); });
    const store = createWhiteboardStore();
    store.getState().addInstrument("ruler");
    const resize = elements(InstrumentLayer({ store, editable: true, width: 1000, height: 750 }))
      .find((element) => element.props.className === "cursor-ew-resize")!.props.onPointerDown!;
    resize(h.event);
    h.fire("pointermove", 790, 1, { pointerType });
    const held = store.getState().instruments[0];
    h.fire("pointermove", 950, 1, { pointerType, buttons: 0 });
    h.fire("pointermove", 1050, 1, { pointerType });
    expect(store.getState().instruments).toEqual([held]);
    expect(h.listenerCount()).toBe(0);
  });

  it.each(["pointercancel", "lostpointercapture", "blur", "pagehide", "visibilitychange", "unmount"])("cancels ruler dragging on %s and removes its listeners", (reason) => {
    const h = pointerHarness(740, 240);
    const store = createWhiteboardStore();
    store.getState().addInstrument("ruler");
    const before = store.getState().instruments[0];
    elements(InstrumentLayer({ store, editable: true, width: 1000, height: 750 }))
      .find((element) => element.props.className === "cursor-ew-resize")!.props.onPointerDown!(h.event);
    h.fire("pointermove", 790);
    expect(store.getState().instruments[0].width).toBeGreaterThan(before.width);
    if (reason === "lostpointercapture") h.target.dispatchEvent(Object.assign(new Event(reason), { pointerId: 1 }));
    else if (reason === "visibilitychange") {
      h.owner.visibilityState = "hidden";
      h.owner.dispatchEvent(new Event(reason));
    } else if (reason === "unmount") effects.cleanups.splice(0).forEach((cleanup) => cleanup());
    else h.fire(reason, 790);
    h.fire("pointermove", 950);
    expect(store.getState().instruments).toEqual([before]);
    expect(h.listenerCount()).toBe(0);
    expect(h.target.hasPointerCapture(1)).toBe(false);
  });

  it("ignores other pointers and measures a rotated ruler along its own length", () => {
    const h = pointerHarness(500, 480);
    const store = createWhiteboardStore();
    store.getState().addInstrument("ruler");
    const before = { ...store.getState().instruments[0], rotation: 90 };
    store.getState().updateInstrument(before);
    elements(InstrumentLayer({ store, editable: true, width: 1000, height: 750 }))
      .find((element) => element.props.className === "cursor-ew-resize")!.props.onPointerDown!(h.event);
    h.fire("pointermove", 700, 2);
    h.fire("pointerup", 700, 2);
    h.target.dispatchEvent(Object.assign(new Event("lostpointercapture"), { pointerId: 2 }));
    expect(store.getState().instruments).toEqual([before]);
    h.fire("pointermove", 550);
    expect(store.getState().instruments[0].width).toBeCloseTo(before.width);
    h.fire("pointermove", 500, 1, { clientY: 530 });
    h.fire("pointerup", 500, 1, { clientY: 530 });
    expect(store.getState().instruments[0].width).toBeCloseTo(before.width + 0.1);
    expect(store.getState().instruments[0].rotation).toBe(90);
  });
});

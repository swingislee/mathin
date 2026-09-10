import { isValidElement, type ReactElement, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardObjectLayer } from "@/features/whiteboard/BoardObjectLayer";
import { InstrumentLayer } from "@/features/whiteboard/InstrumentLayer";
import { createWhiteboardStore, type WhiteboardStore } from "@/features/whiteboard/store";
import { createShapeFromDrag } from "@/features/whiteboard/geometry";

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (value: unknown) => [value, vi.fn()],
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

function pointerHarness() {
  const listeners = new Map<string, Set<(event: object) => void>>();
  vi.stubGlobal("window", {
    addEventListener: (type: string, listener: (event: object) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: (event: object) => void) => listeners.get(type)?.delete(listener),
  });
  const fire = (type: string, x: number, pointerId = 1) => {
    for (const listener of [...listeners.get(type) ?? []]) listener({ type, pointerId, clientX: x, clientY: 300, preventDefault: vi.fn() });
  };
  const event = {
    pointerId: 1, isPrimary: true, button: 0, clientX: 400, clientY: 300,
    nativeEvent: { clientX: 400, clientY: 300 },
    currentTarget: { ownerSVGElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 750 }) } },
    preventDefault: vi.fn(), stopPropagation: vi.fn(),
  } as unknown as ReactPointerEvent<SVGElement>;
  return { fire, event };
}

afterEach(() => vi.unstubAllGlobals());

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
});

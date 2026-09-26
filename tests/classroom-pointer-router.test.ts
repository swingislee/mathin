import { afterEach, describe, expect, it, vi } from "vitest";
import { useClassroomPointerRouter } from "@/features/classroom/input/useClassroomPointerRouter";
import { CLASSROOM_INK_INPUT_PROVIDER_V1, classroomInputProviderAttributes } from "@/features/classroom/input/provider";
import type { ClassroomInputCapability } from "@/features/classroom/input/router";

const lifecycle = vi.hoisted(() => ({ cleanups: [] as Array<() => void> }));
vi.mock("react", () => ({
  useEffect: (setup: () => void | (() => void)) => {
    const cleanup = setup();
    if (cleanup) lifecycle.cleanups.push(cleanup);
  },
}));

function harness(capability: ClassroomInputCapability = "click") {
  const host = Object.assign(new EventTarget(), {
    getSelection: () => ({ removeAllRanges: vi.fn() }), setTimeout, clearTimeout,
  });
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const captured = new Map<number, FakeElement>();
  const pendingCapture = new Map<number, FakeElement>();
  class FakeElement extends EventTarget {
    parent: FakeElement | null = null;
    attributes: Record<string, string | number | undefined> = {};
    style = {
      touchAction: "", userSelect: "", webkitUserSelect: "",
      getPropertyValue: () => "", setProperty: vi.fn(), removeProperty: vi.fn(),
    };
    getAttribute(name: string) { return this.attributes[name] === undefined ? null : String(this.attributes[name]); }
    contains(node: unknown): boolean { return node instanceof FakeElement && (node === this || this.contains(node.parent)); }
    getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 750 }; }
    setPointerCapture(id: number) { pendingCapture.set(id, this); }
    hasPointerCapture(id: number) { return pendingCapture.get(id) === this; }
    releasePointerCapture(id: number) { if (this.hasPointerCapture(id)) pendingCapture.delete(id); }
  }
  const profile = { renderer: "document", audited: true, provisional: false, provider: CLASSROOM_INK_INPUT_PROVIDER_V1 };
  const stage = new FakeElement(), child = new FakeElement();
  stage.attributes = classroomInputProviderAttributes(profile.renderer, profile.provider);
  child.attributes = { "data-classroom-input": capability };
  child.parent = stage;
  vi.stubGlobal("window", host);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("Node", FakeElement);
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const port = { begin: vi.fn(() => true), append: vi.fn(() => true), finish: vi.fn(() => true), cancel: vi.fn(() => true) };
  const inkStart = vi.fn();
  // 挂载真实监听器，用 DOM 事件序列验证输入所有权。
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useClassroomPointerRouter({ stageRef: { current: stage as unknown as HTMLElement }, inputPortRef: { current: port },
    enabled: true, mode: "smart", tool: "pen", profile, gestureKey: "page-1", onInkStart: inkStart });

  const dispatch = (type: string, target: FakeElement, fields: Record<string, unknown>) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: target });
    Object.assign(event, fields, { composedPath: () => target === stage ? [stage] : [target, stage] });
    stage.dispatchEvent(event);
    return event;
  };
  // 浏览器在下一次指针事件前，先通知旧捕获节点 lost，再通知新节点 got。
  const processCapture = (pointerId: number) => {
    const previous = captured.get(pointerId), next = pendingCapture.get(pointerId);
    if (previous === next) return;
    if (previous) dispatch("lostpointercapture", previous, { pointerId });
    if (next) dispatch("gotpointercapture", next, { pointerId });
    if (next) captured.set(pointerId, next);
    else captured.delete(pointerId);
  };
  const pointer = (type: string, clientX: number, pointerType = "touch", pointerId = 7) => {
    processCapture(pointerId);
    if (type === "pointerdown" && pointerType !== "mouse") pendingCapture.set(pointerId, child);
    const event = dispatch(type, captured.get(pointerId) ?? child, {
      pointerId, pointerType, clientX, clientY: 150, button: 0, isPrimary: true,
      buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1, pressure: 0.5,
    });
    if (type === "pointerup" || type === "pointercancel") {
      pendingCapture.delete(pointerId);
      processCapture(pointerId);
    }
    return event;
  };
  const loseCapture = (pointerId = 7) => { pendingCapture.delete(pointerId); processCapture(pointerId); };
  return { port, inkStart, pointer, loseCapture, stage, child, captured, dispatch, host };
}

afterEach(() => {
  lifecycle.cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
});

describe("Smart classroom pointer capture", () => {
  it.each(["touch", "pen", "mouse"])("keeps a %s stroke writing after taking over a clickable courseware child", (pointerType) => {
    const h = harness();
    h.pointer("pointerdown", 100, pointerType);
    h.pointer("pointermove", 107, pointerType);
    expect(h.port.begin).not.toHaveBeenCalled();
    h.pointer("pointermove", 110, pointerType);
    expect(h.port.begin).toHaveBeenCalledWith(7, [0.1, 0.2, expect.any(Object)]);
    h.pointer("pointermove", 160, pointerType);
    expect(h.captured.get(7)).toBe(h.stage);
    expect(h.port.finish).not.toHaveBeenCalled();
    expect(h.port.cancel).not.toHaveBeenCalled();
    expect(h.port.append).toHaveBeenLastCalledWith(7, [[0.16, 0.2, expect.any(Object)]]);
    h.pointer("pointerup", 300, pointerType);
    expect(h.port.finish).toHaveBeenCalledExactlyOnceWith(7, [[0.3, 0.2, expect.any(Object)]]);
    expect(h.inkStart).toHaveBeenCalledOnce();
    expect(h.dispatch("click", h.child, { pointerId: 7 }).defaultPrevented).toBe(true);
  });

  it.each(["click", "drag", "native"] as const)("preserves native %s interaction and its capture release", (capability) => {
    const h = harness(capability);
    expect(h.pointer("pointerdown", 100).defaultPrevented).toBe(false);
    expect(h.pointer("pointermove", 104).defaultPrevented).toBe(false);
    expect(h.pointer("pointerup", 104).defaultPrevented).toBe(false);
    expect(h.dispatch("click", h.child, { pointerId: 7 }).defaultPrevented).toBe(false);
    expect(h.port.begin).not.toHaveBeenCalled();
    expect(h.port.finish).not.toHaveBeenCalled();
  });

  it("finishes only the active pointer when the stage itself loses capture", () => {
    const h = harness("ink");
    h.pointer("pointerdown", 100);
    h.pointer("pointermove", 150);
    h.dispatch("lostpointercapture", h.stage, { pointerId: 9 });
    expect(h.port.finish).not.toHaveBeenCalled();
    h.loseCapture();
    expect(h.port.finish).toHaveBeenCalledExactlyOnceWith(7);
    h.pointer("pointermove", 200);
    expect(h.port.append).toHaveBeenCalledTimes(1);
    h.pointer("pointerdown", 300, "touch", 8);
    h.pointer("pointerup", 400, "touch", 8);
    expect(h.port.begin).toHaveBeenCalledTimes(2);
    expect(h.port.finish).toHaveBeenLastCalledWith(8, [[0.4, 0.2, expect.any(Object)]]);
  });

  it("still cancels ink when palm or viewport handling cancels the original touch", () => {
    const h = harness();
    h.pointer("pointerdown", 100);
    h.pointer("pointermove", 110);
    h.pointer("pointermove", 160);
    h.dispatch("pointercancel", h.child, { pointerId: 7, pointerType: "touch" });
    expect(h.port.cancel).toHaveBeenCalledExactlyOnceWith(7);
    expect(h.port.finish).not.toHaveBeenCalled();
    h.pointer("pointerup", 200);
    expect(h.port.finish).not.toHaveBeenCalled();
    h.pointer("pointerdown", 300, "touch", 8);
    h.pointer("pointermove", 320, "touch", 8);
    expect(h.port.begin).toHaveBeenCalledTimes(2);
  });
});

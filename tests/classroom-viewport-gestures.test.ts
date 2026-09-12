import { afterEach, describe, expect, it, vi } from "vitest";
import { useClassroomViewportGestures } from "@/features/classroom/live/useClassroomViewportGestures";
import { CLASSROOM_VIEWPORT_PROTOCOL } from "@/features/classroom/live/classroom-viewport";

const lifecycle = vi.hoisted(() => ({ cleanups: [] as Array<() => void> }));
vi.mock("react", () => ({ useRef: (value: unknown) => ({ current: value }), useLayoutEffect: (fn: () => void) => fn(),
  useEffect: (fn: () => void | (() => void)) => { const cleanup = fn(); if (cleanup) lifecycle.cleanups.push(cleanup); } }));

function harness(options: { palm?: boolean; viewport?: boolean } = {}) {
  const host = new EventTarget();
  const doc = Object.assign(new EventTarget(), { defaultView: host, hidden: false });
  class FakePointerEvent extends Event {
    constructor(type: string, fields: Record<string, unknown>) {
      super(type, { cancelable: true, bubbles: Boolean(fields.bubbles) });
      for (const [key, value] of Object.entries(fields)) if (key !== "bubbles") Object.defineProperty(this, key, { value });
    }
  }
  class FakeNode extends EventTarget {
    ownerDocument = doc;
    style = { touchAction: "none" };
    parentElement: FakeNode | null = null;
    frames: FakeFrame[] = [];
    contains(target: unknown) { return target === this || this.frames.includes(target as FakeFrame); }
    querySelectorAll() { return this.frames; }
    getBoundingClientRect() { return { top: 0, left: 0, width: 1920, height: 1080 }; }
  }
  class FakeFrame extends FakeNode { contentWindow = { postMessage: vi.fn() }; }
  const viewport = new FakeNode(), stage = new FakeNode(), frame = new FakeFrame();
  stage.parentElement = viewport; stage.frames = [frame];
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal("Node", FakeNode); vi.stubGlobal("HTMLIFrameElement", FakeFrame); vi.stubGlobal("PointerEvent", FakePointerEvent);
  vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const change = vi.fn(), end = vi.fn(), cancelInk = vi.fn(), palmStart = vi.fn(), cancelInput = vi.fn();
  const port = { begin: vi.fn(() => true), append: vi.fn(() => true), finish: vi.fn(() => true), cancel: vi.fn(() => true), cancelActive: vi.fn(() => true) };
  const penPointers = { current: new Set<string>() };
  // 测试用 React 生命周期桩挂载真实输入监听器。
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useClassroomViewportGestures({ enabled: options.viewport !== false, stageRef: { current: stage as unknown as HTMLDivElement }, gestureKey: "page-1", percent: 75, min: 40, max: 100,
    onChange: change, onEnd: end, onCancelInk: cancelInk,
    palm: options.palm ? { threshold: 30, inputPortRef: { current: port }, penPointers, onStart: palmStart, onCancelInput: cancelInput } : undefined });
  const pointer = (type: string, id: number, x = id * 200, y = 540, pointerType = "touch", size = 10) => {
    const event = new FakePointerEvent(type, { pointerId: id, screenX: x, screenY: y, clientX: x, clientY: y, width: size, height: size, pointerType });
    Object.defineProperty(event, "target", { value: stage });
    host.dispatchEvent(event);
    return event;
  };
  const receive = (source: unknown, data: object) => {
    const event = Object.assign(new Event("message"), { source, data: { protocol: CLASSROOM_VIEWPORT_PROTOCOL, ...data } });
    host.dispatchEvent(event);
  };
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(0)); };
  const token = frame.contentWindow.postMessage.mock.calls[0][0].token as string;
  return { stage, frame, token, pointer, receive, flush, change, end, cancelInk, port, penPointers, palmStart, cancelInput, host };
}
afterEach(() => { lifecycle.cleanups.splice(0).reverse().forEach((cleanup) => cleanup()); vi.unstubAllGlobals(); });

describe("classroom two-finger input ownership", () => {
  it("cancels provisional ink on the second finger and consumes the remaining touch sequence", () => {
    const h = harness();
    expect(h.pointer("pointerdown", 8, 10, 10, "pen").defaultPrevented).toBe(false);
    expect(h.pointer("pointerdown", 1, 800).defaultPrevented).toBe(false);
    expect(h.pointer("pointerdown", 2, 1000).defaultPrevented).toBe(true);
    expect(h.cancelInk).toHaveBeenCalledWith(1);
    expect(h.pointer("pointermove", 1, 600).defaultPrevented).toBe(true);
    h.flush();
    expect(h.change).toHaveBeenLastCalledWith(100, 0.5);
    expect(h.pointer("pointerup", 2, 1000).defaultPrevented).toBe(true);
    expect(h.pointer("pointermove", 1, 650).defaultPrevented).toBe(true);
    expect(h.pointer("pointerup", 1, 650).defaultPrevented).toBe(true);
    expect(h.end).toHaveBeenCalledOnce();
    expect(h.pointer("pointerdown", 3, 500).defaultPrevented).toBe(false);
  });

  it("combines stage and iframe fingers and rejects unknown sources or tokens", () => {
    const h = harness(); h.pointer("pointerdown", 1, 800);
    const touch = { type: "touch", phase: "down", id: 1, x: 1000, y: 540, ny: 0.5, token: h.token };
    h.receive({}, touch); h.receive(h.frame.contentWindow, { ...touch, token: "wrong" });
    expect(h.cancelInk).not.toHaveBeenCalled();
    h.receive(h.frame.contentWindow, touch);
    expect(h.cancelInk).toHaveBeenCalledWith(1);
    expect(h.frame.contentWindow.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "reserve", active: true, token: h.token }), "*");
    h.receive(h.frame.contentWindow, { ...touch, phase: "move", x: 1200 }); h.flush();
    expect(h.change).toHaveBeenLastCalledWith(100, 0.5);
    h.receive(h.frame.contentWindow, { type: "cancel-all", token: h.token });
    expect(h.end).toHaveBeenCalledOnce();
  });

  it("reserves a palm, erases from its original point, and releases without changing the selected tool", () => {
    const h = harness({ palm: true, viewport: false });
    expect(h.pointer("pointerdown", 1, 960, 540, "touch", 60).defaultPrevented).toBe(true);
    expect(h.port.begin).toHaveBeenCalledWith(1, [0.5, 0.5], { eraserWidth: 69 / 1920 });
    expect(h.cancelInput).toHaveBeenCalledOnce();
    expect(h.port.cancelActive).toHaveBeenCalledOnce();
    h.pointer("pointermove", 1, 1000, 540, "touch", 80);
    expect(h.port.begin).toHaveBeenCalledWith(1, [0.5, 0.5], { eraserWidth: 69 / 1920 });
    expect(h.palmStart).toHaveBeenCalledOnce();
    h.pointer("pointermove", 1, 1100, 540, "touch", 90);
    h.pointer("pointerup", 1, 1100);
    expect(h.port.begin).toHaveBeenCalledOnce();
    expect(h.port.finish).toHaveBeenCalledWith(1, [[1100 / 1920, 0.5]]);
    expect(h.change).not.toHaveBeenCalled();
    expect(h.pointer("pointerdown", 2).defaultPrevented).toBe(false);
  });

  it("keeps two ordinary fingers owned by the viewport even if a contact later grows", () => {
    const h = harness({ palm: true });
    h.pointer("pointerdown", 1, 800); h.pointer("pointerdown", 2, 1000);
    h.pointer("pointermove", 1, 600, 540, "touch", 80); h.flush();
    expect(h.change).toHaveBeenCalled();
    expect(h.port.begin).not.toHaveBeenCalled();
  });

  it("ignores a palm while a pen writes and cancels an active palm when the pen arrives", () => {
    const h = harness({ palm: true });
    h.pointer("pointerdown", 9, 10, 10, "pen");
    h.pointer("pointerdown", 1, 900, 540, "touch", 80); h.pointer("pointermove", 1, 1000, 540, "touch", 80);
    expect(h.port.begin).not.toHaveBeenCalled();
    expect(h.port.cancelActive).not.toHaveBeenCalled();
    h.pointer("pointerup", 1); h.pointer("pointerup", 9, 10, 10, "pen");
    h.pointer("pointerdown", 2, 900, 540, "touch", 80); h.pointer("pointermove", 2, 1000, 540, "touch", 80);
    h.pointer("pointerdown", 10, 10, 10, "pen");
    expect(h.port.cancel).toHaveBeenCalledWith(2);
    h.pointer("pointerup", 2);
    expect(h.port.finish).not.toHaveBeenCalled();
    expect(h.change).not.toHaveBeenCalled();
  });

  it("cancels palm work on pointercancel or blur, consuming remaining touches until released", () => {
    const h = harness({ palm: true });
    h.pointer("pointerdown", 1, 900, 540, "touch", 80); h.pointer("pointermove", 1, 1000, 540, "touch", 80);
    h.pointer("pointerdown", 2); h.pointer("pointercancel", 1);
    expect(h.port.cancel).toHaveBeenCalledWith(1);
    expect(h.pointer("pointermove", 2).defaultPrevented).toBe(true);
    h.pointer("pointerup", 2);
    h.pointer("pointerdown", 3, 900, 540, "touch", 80); h.pointer("pointermove", 3, 1000, 540, "touch", 80);
    h.host.dispatchEvent(new Event("blur"));
    expect(h.port.cancel).toHaveBeenCalledWith(3);
    expect(h.port.finish).not.toHaveBeenCalled();
  });

  it("accepts calibrated frame contacts only from their registered source and token", () => {
    const h = harness({ palm: true, viewport: false });
    const packet = { type: "touch", phase: "down", token: h.token, id: 1, x: 960, y: 540, nx: 0.5, ny: 0.5, nw: 80 / 1920, nh: 80 / 1080 };
    h.receive({}, packet); h.receive(h.frame.contentWindow, { ...packet, token: "wrong" });
    h.receive(h.frame.contentWindow, { ...packet, nw: 2 });
    expect(h.cancelInput).not.toHaveBeenCalled();
    h.receive(h.frame.contentWindow, packet); h.receive(h.frame.contentWindow, { ...packet, phase: "move", nx: 0.6 });
    expect(h.port.begin).toHaveBeenCalledWith(1, [0.5, 0.5], { eraserWidth: 92 / 1920 });
    h.receive(h.frame.contentWindow, { type: "pen", phase: "down", token: h.token, id: 9 });
    expect(h.port.cancel).toHaveBeenCalledWith(1);
  });
});

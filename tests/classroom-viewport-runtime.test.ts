import { Script } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { CLASSROOM_VIEWPORT_RUNTIME } from "@/features/courseware-doc/classroom-viewport-runtime";
import { CLASSROOM_VIEWPORT_PROTOCOL } from "@/features/classroom/live/classroom-viewport";

function harness() {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  class PointerEvent { constructor(readonly type: string, fields: object) { Object.assign(this, fields); } }
  const target = { dispatchEvent: vi.fn(), style: { touchAction: "pan-y" } };
  class Frame {
    contentWindow = { postMessage: vi.fn() };
    src = "/api/cw-h5/packages/hash/child.html?mathin_classroom_keys=1";
    getAttribute() { return this.src; }
    setAttribute(_key: string, value: string) { this.src = value; }
    getBoundingClientRect() { return { left: 100, width: 500, top: 100, height: 400 }; }
  }
  const child = new Frame();
  const parent = { postMessage: vi.fn() };
  const document = { documentElement: target, hidden: false, baseURI: "http://example.test/api/cw-h5/packages/hash/index.html", querySelectorAll: () => [child],
    addEventListener: vi.fn(), contains: () => true };
  new Script(CLASSROOM_VIEWPORT_RUNTIME.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "")).runInNewContext({
    window: { addEventListener: (name: string, callback: (event: Record<string, unknown>) => void) => listeners.set(name, callback) },
    document, parent, innerWidth: 1000, innerHeight: 800, PointerEvent, HTMLIFrameElement: Frame, URL, performance: { now: () => 1000 }, MutationObserver: class { observe() {} },
  });
  const message = (source: unknown, data: object) => listeners.get("message")!({ source, data: { protocol: CLASSROOM_VIEWPORT_PROTOCOL, ...data } });
  const configure = (options: object = {}) => message(parent, { type: "configure", enabled: true, token: "viewport-token", ...options });
  const pointer = (type: string, id: number, pointerType = "touch", contact = { width: 10, height: 10 }) => {
    const event = { type, pointerId: id, pointerType, screenX: id * 100, screenY: 400, clientX: 500, clientY: 400, ...contact, target, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    listeners.get(type)!(event);
    return event;
  };
  return { message, configure, pointer, parent, target, child };
}

describe("opaque H5 viewport touch bridge", () => {
  it("preserves standalone, single-finger and pen input until the second finger takes over", () => {
    const h = harness();
    expect(h.pointer("pointerdown", 1).preventDefault).not.toHaveBeenCalled();
    h.message({}, { type: "configure", enabled: true, token: "fake" });
    expect(h.pointer("pointerdown", 2).preventDefault).not.toHaveBeenCalled();
    h.configure();
    h.parent.postMessage.mockClear();
    expect(h.pointer("pointerdown", 3, "pen").preventDefault).not.toHaveBeenCalled();
    expect(h.parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "pen", phase: "down", id: 3 }), "*");
    expect(h.pointer("pointerdown", 4).preventDefault).not.toHaveBeenCalled();
    expect(h.pointer("pointerdown", 5).preventDefault).toHaveBeenCalled();
    expect(h.target.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "pointercancel", pointerId: 4 }));
    expect(h.pointer("pointermove", 4).stopImmediatePropagation).toHaveBeenCalled();
    expect(h.pointer("pointerup", 5).preventDefault).toHaveBeenCalled();
    expect(h.pointer("pointerup", 4).preventDefault).toHaveBeenCalled();
    expect(h.parent.postMessage.mock.calls.filter(([p]) => p.type === "touch")).toHaveLength(5);
  });

  it("accepts takeover only from its configured parent and relays known children with unique ids", () => {
    const h = harness(); h.configure(); h.parent.postMessage.mockClear();
    h.pointer("pointerdown", 1);
    h.message({}, { type: "reserve", active: true, token: "viewport-token" });
    expect(h.pointer("pointermove", 1).preventDefault).not.toHaveBeenCalled();
    h.message(h.child.contentWindow, { type: "touch", phase: "down", token: "bad", id: 1, x: 100, y: 400, ny: 0.5 });
    const before = h.parent.postMessage.mock.calls.length;
    h.message({}, { type: "touch", phase: "down", token: "viewport-token", id: 1, x: 100, y: 400, ny: 0.5 });
    expect(h.parent.postMessage).toHaveBeenCalledTimes(before);
    h.message(h.child.contentWindow, { type: "touch", phase: "down", token: "viewport-token", id: 1, x: 100, y: 400, ny: 0.5 });
    expect(h.parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ id: 100001, ny: 0.375 }), "*");
    expect(h.child.src).toContain("mathin_classroom_viewport=2");
  });

  it("quarantines a large palm synchronously before H5 input while ordinary fingers retain their input", () => {
    const h = harness(); h.configure({ viewport: false, palmThreshold: 30 });
    expect(h.pointer("pointerdown", 1).preventDefault).not.toHaveBeenCalled();
    expect(h.pointer("pointerdown", 2).preventDefault).not.toHaveBeenCalled();
    expect(h.pointer("pointerdown", 3, "touch", { width: 60, height: 80 }).stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(h.parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "touch", nx: 0.5, ny: 0.5, nw: 0.06, nh: 0.1 }), "*");
    expect(h.pointer("pointerup", 3).preventDefault).toHaveBeenCalled();
    expect(h.pointer("pointermove", 1).preventDefault).toHaveBeenCalled();
    h.message(h.parent, { type: "reserve", token: "viewport-token", active: false });
    expect(h.pointer("pointermove", 1).preventDefault).not.toHaveBeenCalled();
  });

  it("maps a scaled nested contact into the parent coordinate space and preserves pen priority", () => {
    const h = harness(); h.configure({ viewport: false, palmThreshold: 30, scaleX: 2, scaleY: 2 });
    expect(h.pointer("pointerdown", 1, "touch", { width: 20, height: 20 }).preventDefault).toHaveBeenCalled();
    h.parent.postMessage.mockClear();
    const packet = { type: "touch", phase: "down", token: "viewport-token", id: 5, x: 100, y: 400, nx: 0.5, ny: 0.5, nw: 0.12, nh: 0.2 };
    h.message(h.child.contentWindow, { ...packet, nw: Infinity });
    expect(h.parent.postMessage).not.toHaveBeenCalled();
    h.message(h.child.contentWindow, packet);
    expect(h.parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ nx: 0.35, ny: 0.375, nw: 0.06, nh: 0.1 }), "*");
    h.message(h.child.contentWindow, { type: "pen", phase: "down", token: "viewport-token", id: 7 });
    const id = h.parent.postMessage.mock.calls.at(-1)![0].id;
    h.message(h.child.contentWindow, { type: "pen", phase: "up", token: "viewport-token", id: 7 });
    expect(h.parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "pen", phase: "up", id }), "*");
  });
});

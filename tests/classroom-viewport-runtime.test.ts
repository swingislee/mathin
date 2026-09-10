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
    getBoundingClientRect() { return { top: 100, height: 400 }; }
  }
  const child = new Frame();
  const parent = { postMessage: vi.fn() };
  const document = { documentElement: target, hidden: false, baseURI: "http://example.test/api/cw-h5/packages/hash/index.html", querySelectorAll: () => [child],
    addEventListener: vi.fn(), contains: () => true };
  new Script(CLASSROOM_VIEWPORT_RUNTIME.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "")).runInNewContext({
    window: { addEventListener: (name: string, callback: (event: Record<string, unknown>) => void) => listeners.set(name, callback) },
    document, parent, innerHeight: 800, PointerEvent, HTMLIFrameElement: Frame, URL, performance: { now: () => 1000 }, MutationObserver: class { observe() {} },
  });
  const message = (source: unknown, data: object) => listeners.get("message")!({ source, data: { protocol: CLASSROOM_VIEWPORT_PROTOCOL, ...data } });
  const configure = () => message(parent, { type: "configure", enabled: true, token: "viewport-token" });
  const pointer = (type: string, id: number, pointerType = "touch") => {
    const event = { type, pointerId: id, pointerType, screenX: id * 100, screenY: 400, clientY: 400, target, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
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
    expect(h.parent.postMessage).not.toHaveBeenCalled();
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
    expect(h.child.src).toContain("mathin_classroom_viewport=1");
  });
});

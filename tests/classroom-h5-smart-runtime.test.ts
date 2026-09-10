import { Script } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { H5_OPAQUE_ORIGIN_RUNTIME } from "@/features/courseware-doc/h5-shim";
import { h5PointerGestureMessage, h5PointerParentMessage } from "@/features/courseware-doc/h5-pointer-protocol";

function harness() {
  type Fields = Record<string, unknown>;
  const documentListeners = new Map<string, (event: Fields) => void>();
  const windowListeners = new Map<string, (event: Fields) => void>();
  class Element {
    constructor(readonly attributes: Record<string, string> = {}, readonly nativeControl = false) {}
    style = { userSelect: "text", webkitUserSelect: "text", getPropertyValue: () => "", setProperty: vi.fn(), removeProperty: vi.fn() };
    getAttribute(name: string) { return this.attributes[name] ?? null; }
    hasAttribute(name: string) { return name in this.attributes; }
    matches() { return this.nativeControl; }
    contains(target: unknown) { return target === this; }
    setPointerCapture = vi.fn();
    hasPointerCapture() { return false; }
  }
  class Frame extends Element {
    contentWindow = { postMessage: vi.fn() };
    getBoundingClientRect() { return { left: 100, top: 50, width: 400, height: 300 }; }
  }
  const root = new Element();
  const frames = [new Frame(), new Frame()];
  const parent = { postMessage: vi.fn() };
  const document = {
    documentElement: root,
    querySelectorAll: (selector: string) => selector === "iframe" ? frames : [],
    addEventListener: (type: string, listener: (event: Fields) => void) => documentListeners.set(type, listener),
  };
  const window = {
    innerWidth: 1000, innerHeight: 750, getSelection: () => ({ removeAllRanges: vi.fn() }),
    addEventListener: (type: string, listener: (event: Fields) => void) => windowListeners.set(type, listener),
  };
  new Script(H5_OPAQUE_ORIGIN_RUNTIME.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "")).runInNewContext({
    window, document, parent, Element, Node: Element, HTMLIFrameElement: Frame, HTMLMediaElement: class {},
    performance: { now: () => 1000 }, requestAnimationFrame: () => 1, cancelAnimationFrame: vi.fn(), setTimeout: vi.fn(),
  });
  const message = (source: unknown, data: Fields) => windowListeners.get("message")!({ source, data });
  const configure = (mode: "smart" | "interaction-lock" = "smart") => {
    message(parent, h5PointerParentMessage("pointer_hello", "frame", "token"));
    message(parent, h5PointerParentMessage("pointer_ack", "frame", "token", { mode }));
    parent.postMessage.mockClear();
  };
  const pointer = (type: string, target: Element, x = 200, extra: Fields = {}) => {
    const event = { target, pointerId: 1, pointerType: "pen", isPrimary: true, button: 0,
      clientX: x, clientY: 200, composedPath: () => [target, root], preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra };
    documentListeners.get(type)!(event);
    return event;
  };
  const packets = () => parent.postMessage.mock.calls.map(([packet]) => packet);
  const childPacket = (extra: Fields) => ({ source: "mathin-h5-pointer", schema: "mathin-h5-pointer", version: 1, frameId: "frame", channelToken: "token", ...extra });
  return { Element, parent, root, frames, message, configure, pointer, packets, childPacket, documentListeners };
}

describe("basic H5 Smart input", () => {
  it("offers click routing without a package profile and preserves the original tap", () => {
    const h = harness();
    h.message(h.parent, h5PointerParentMessage("pointer_hello", "frame", "token"));
    expect(h.packets()).toContainEqual(expect.objectContaining({ type: "pointer_capabilities", defaultCapability: "click", providerVersion: 1 }));
    h.configure();
    const button = new h.Element();
    expect(h.pointer("pointerdown", button).preventDefault).not.toHaveBeenCalled();
    expect(h.pointer("pointerup", button).preventDefault).not.toHaveBeenCalled();
    expect(h.pointer("click", button).preventDefault).not.toHaveBeenCalled();
    expect(h.packets().map((packet) => packet.type)).toEqual(["pointer_start", "pointer_end"]);
    expect(h.packets()[0]).toMatchObject({ capability: "click", x: 0.2 });
  });

  it("leaves registered drags and native form controls with the H5", () => {
    const h = harness(); h.configure();
    for (const target of [new h.Element({ "data-classroom-input": "drag" }), new h.Element({ "data-classroom-input": "native" }), new h.Element({}, true)]) {
      expect(h.pointer("pointerdown", target).preventDefault).not.toHaveBeenCalled();
      expect(h.pointer("pointermove", target, 350).preventDefault).not.toHaveBeenCalled();
      h.pointer("pointerup", target, 350);
    }
    expect(h.packets()).toEqual([]);
  });

  it("suppresses the original click after ink takeover, and pointer selection disables ink", () => {
    const h = harness(); h.configure();
    const target = new h.Element();
    h.pointer("pointerdown", target);
    const gestureToken = h.packets()[0].gestureToken;
    h.message({}, h5PointerGestureMessage("pointer_takeover", "frame", "token", gestureToken));
    expect(h.pointer("pointermove", target, 205).preventDefault).not.toHaveBeenCalled();
    h.message(h.parent, h5PointerGestureMessage("pointer_takeover", "frame", "token", gestureToken));
    expect(h.pointer("pointermove", target, 250).preventDefault).toHaveBeenCalled();
    expect(h.pointer("pointerup", target, 250).preventDefault).toHaveBeenCalled();
    expect(h.pointer("click", target, 250).preventDefault).toHaveBeenCalled();
    h.message(h.parent, h5PointerParentMessage("pointer_mode", "frame", "token", { mode: "interaction-lock" }));
    h.parent.postMessage.mockClear();
    const ink = new h.Element({ "data-classroom-input": "ink" });
    expect(h.pointer("pointerdown", ink).preventDefault).not.toHaveBeenCalled();
    expect(h.packets()).toEqual([]);
    h.message(h.parent, h5PointerParentMessage("pointer_mode", "frame", "token", { mode: "smart" }));
    expect(h.pointer("pointerdown", ink).preventDefault).toHaveBeenCalled();
  });

  it("isolates incompatible children and validates each nested source and token", () => {
    const h = harness(); h.configure();
    const capability = { type: "pointer_capabilities", providerSchema: "mathin-classroom-input", providerVersion: 1, defaultCapability: "click" };
    h.message(h.frames[0].contentWindow, h.childPacket({ ...capability, providerVersion: 99 }));
    h.message(h.frames[1].contentWindow, h.childPacket(capability));
    const start = h.childPacket({ type: "pointer_start", pointerId: 1, pointerType: "touch", gestureToken: "nested", capability: "click", isPrimary: true, button: 0, x: 0.5, y: 0.5 });
    h.message({}, start);
    h.message(h.frames[0].contentWindow, start);
    h.message(h.frames[1].contentWindow, { ...start, channelToken: "old-token" });
    expect(h.packets()).toEqual([]);
    h.message(h.frames[1].contentWindow, start);
    expect(h.packets()[0]).toMatchObject({ type: "pointer_start", x: 0.3, y: 200 / 750, relayDepth: 1 });
    h.parent.postMessage.mockClear();
    h.documentListeners.get("load")!({ target: h.frames[1] });
    expect(h.packets()).toContainEqual(expect.objectContaining({ type: "pointer_cancel", gestureToken: "nested", pointerId: 1 }));
    h.parent.postMessage.mockClear();
    h.message(h.frames[1].contentWindow, start);
    expect(h.packets()).toEqual([]);
    h.pointer("pointerdown", new h.Element());
    expect(h.packets()).toContainEqual(expect.objectContaining({ type: "pointer_start", capability: "click" }));
  });
});

import { Script } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { CLASSROOM_PAGING_PROTOCOL, classroomPagingDirection, withClassroomPagingRuntime } from "../src/features/classroom/live/classroom-paging";
import { CLASSROOM_PAGING_RUNTIME } from "../src/features/courseware-doc/classroom-paging-runtime";
import { CLASSROOM_NAVIGATION_SYNC_PROVIDERS, MATHIN_MICROCOURSE_SYNC_PROVIDERS } from "../src/features/classroom/sync/interaction-audit";
import { classroomInteractionPayloadWithinBudget, isClassroomInteractionSyncProvider } from "../src/features/classroom/sync/interaction-provider";

function frameHarness() {
  const windowListeners = new Map<string, (event: Record<string, unknown>) => void>();
  class Element {
    editing = false;
    closest() { return this.editing ? this : null; }
  }
  class Frame extends Element {
    contentWindow = { postMessage: vi.fn() };
    src = "/api/cw-h5/packages/hash/child.html";
    getAttribute() { return this.src; }
    setAttribute(_name: string, value: string) { this.src = value; }
  }
  const child = new Frame();
  const parent = { postMessage: vi.fn() };
  const body = new Element();
  const inputChild = new Element(); inputChild.editing = true;
  let modal = false;
  const document = {
    baseURI: "https://example.test/api/cw-h5/packages/hash/index.html",
    activeElement: body as Element,
    querySelectorAll: (selector: string) => selector === "iframe" ? [child] : modal ? [{ getClientRects: () => [1] }] : [],
    addEventListener: vi.fn(),
  };
  const script = CLASSROOM_PAGING_RUNTIME.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
  new Script(script).runInNewContext({
    window: { addEventListener: (name: string, listener: (event: Record<string, unknown>) => void) => windowListeners.set(name, listener) },
    document, parent, Element, HTMLIFrameElement: Frame, URL,
    MutationObserver: class { observe() {} },
  });
  const receive = (source: unknown, data: Record<string, unknown>) => windowListeners.get("message")?.({ source, data: { protocol: CLASSROOM_PAGING_PROTOCOL, ...data } });
  const configure = (enabled = true) => receive(parent, { type: "configure", enabled, token: "classroom-token" });
  const press = (key: string, options: Record<string, unknown> = {}) => {
    const event = { key, target: body, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), ...options };
    windowListeners.get("keydown")?.(event);
    return event;
  };
  return { parent, child, document, body, inputChild, receive, configure, press, showModal: () => { modal = true; } };
}

describe("classroom paging keys", () => {
  it("registers page commands while keeping H5 content read-only", () => {
    const provider = CLASSROOM_NAVIGATION_SYNC_PROVIDERS[CLASSROOM_PAGING_PROTOCOL];
    expect(isClassroomInteractionSyncProvider(provider)).toBe(true);
    expect(provider.eventType).toBe("page");
    expect(classroomInteractionPayloadWithinBudget(provider, { page: 12 })).toBe(true);
    expect(classroomInteractionPayloadWithinBudget(provider, { page: 12, extra: "x".repeat(65) })).toBe(false);
    expect(MATHIN_MICROCOURSE_SYNC_PROVIDERS.h5.mode).toBe("read-only");
  });
  it("uses arrows and space for paging and retains typing, dialogs and modified shortcuts", () => {
    for (const key of ["ArrowRight", "PageDown", " "]) expect(classroomPagingDirection({ key }, false, false)).toBe(1);
    for (const key of ["ArrowLeft", "PageUp"]) expect(classroomPagingDirection({ key }, false, false)).toBe(-1);
    for (const key of ["ArrowRight", "ArrowLeft", " "]) {
      expect(classroomPagingDirection({ key }, true, false)).toBe(0);
      expect(classroomPagingDirection({ key }, false, true)).toBe(0);
      expect(classroomPagingDirection({ key, isComposing: true }, false, false)).toBe(0);
      expect(classroomPagingDirection({ key, ctrlKey: true }, false, false)).toBe(0);
    }
    expect(classroomPagingDirection({ key: "ArrowDown" }, false, false)).toBe(0);
  });

  it("versions the injected runtime without changing the resource path or existing query", () => {
    const href = withClassroomPagingRuntime("/api/cw-h5/package/index.html?mathin_h5_runtime=3#slide");
    expect(href).toBe("/api/cw-h5/package/index.html?mathin_h5_runtime=3&mathin_classroom_keys=1&mathin_classroom_viewport=1#slide");
    expect(withClassroomPagingRuntime(href)).toBe(href);
  });

  it("leaves standalone H5 keys alone until its parent enables classroom paging", () => {
    const frame = frameHarness();
    expect(frame.press(" ").preventDefault).not.toHaveBeenCalled();
    frame.receive({}, { type: "configure", enabled: true, token: "forged" });
    expect(frame.press("ArrowRight").preventDefault).not.toHaveBeenCalled();
    frame.configure();
    frame.parent.postMessage.mockClear();
    for (const key of ["ArrowRight", "ArrowLeft", " "]) {
      const event = frame.press(key);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
    }
    expect(frame.parent.postMessage).toHaveBeenCalledTimes(3);
    expect(frame.parent.postMessage).toHaveBeenLastCalledWith({ protocol: CLASSROOM_PAGING_PROTOCOL, type: "key", token: "classroom-token", key: " " }, "*");
    frame.configure(false);
    expect(frame.press(" ").preventDefault).not.toHaveBeenCalled();
  });

  it("protects text editing inside nested elements and visible dialogs", () => {
    const frame = frameHarness(); frame.configure(); frame.parent.postMessage.mockClear();
    expect(frame.press(" ", { target: frame.inputChild }).preventDefault).not.toHaveBeenCalled();
    expect(frame.press("ArrowRight", { isComposing: true }).preventDefault).not.toHaveBeenCalled();
    frame.showModal();
    expect(frame.press("ArrowLeft").preventDefault).not.toHaveBeenCalled();
    expect(frame.parent.postMessage).not.toHaveBeenCalled();
  });

  it("relays only the focused child frame with the current token and allowed keys", () => {
    const frame = frameHarness(); frame.configure(); frame.parent.postMessage.mockClear();
    const key = { type: "key", key: "ArrowRight", token: "classroom-token" };
    frame.receive(frame.child.contentWindow, key);
    frame.document.activeElement = frame.child;
    frame.receive({}, key);
    frame.receive(frame.child.contentWindow, { ...key, token: "stale" });
    frame.receive(frame.child.contentWindow, { ...key, key: "Enter" });
    expect(frame.parent.postMessage).not.toHaveBeenCalled();
    frame.receive(frame.child.contentWindow, key);
    expect(frame.parent.postMessage).toHaveBeenCalledOnce();
    expect(frame.child.src).toContain("mathin_classroom_keys=1");
  });
});

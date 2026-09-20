import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { useH5PointerBridge } from "@/features/classroom/input/useH5PointerBridge";
import { useH5FrameRegistration } from "@/features/courseware-doc/useH5FrameRegistration";
import type { CanvasSurfaceInputPort } from "@/features/whiteboard/CanvasSurface";
import { H5_POINTER_FRAME_SOURCE, H5_POINTER_PROTOCOL_SCHEMA, H5_POINTER_PROTOCOL_VERSION } from "@/features/courseware-doc/h5-pointer-protocol";

// 执行真实父、子 hook；按 React 的子组件先于父组件提交 passive effect 的顺序复现翻页。
const hooks = vi.hoisted(() => {
  type Slot = { value: unknown; deps?: readonly unknown[]; cleanup?: () => void };
  type Scope = { slots: Slot[]; cursor: number; dirty: boolean; effects: Array<() => void> };
  let active: Scope;
  const scopes: Scope[] = [];
  const same = (a: readonly unknown[] | undefined, b: readonly unknown[]) => a?.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const slot = (initial: () => unknown): Slot => active.slots[active.cursor++] ?? (active.slots[active.cursor - 1] = { value: initial() });
  return {
    scope() { const scope: Scope = { slots: [], cursor: 0, dirty: false, effects: [] }; scopes.push(scope); return scope; },
    render<T>(scope: Scope, run: () => T) { active = scope; scope.cursor = 0; scope.dirty = false; return run(); },
    flush(scope: Scope) { for (const effect of scope.effects.splice(0)) effect(); },
    dispose() { for (const scope of scopes.splice(0).reverse()) for (const entry of scope.slots) entry.cleanup?.(); },
    useRef(value: unknown) { return slot(() => ({ current: value })).value; },
    useState(value: unknown) {
      const scope = active, entry = slot(() => typeof value === "function" ? value() : value);
      return [entry.value, (next: unknown) => {
        const value = typeof next === "function" ? next(entry.value) : next;
        if (!Object.is(value, entry.value)) { entry.value = value; scope.dirty = true; }
      }];
    },
    useMemo(factory: () => unknown, deps: readonly unknown[]) {
      const entry = slot(() => undefined);
      if (!same(entry.deps, deps)) { entry.value = factory(); entry.deps = deps; }
      return entry.value;
    },
    useEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
      const entry = slot(() => undefined);
      if (same(entry.deps, deps)) return;
      entry.deps = deps;
      active.effects.push(() => { entry.cleanup?.(); entry.cleanup = effect() || undefined; });
    },
  };
});
vi.mock("react", () => ({ ...hooks, useCallback: (callback: unknown, deps: readonly unknown[]) => hooks.useMemo(() => callback, deps) }));

function harness() {
  const parent = hooks.scope(), child = hooks.scope();
  const source = { postMessage: vi.fn() };
  const iframe = { contentWindow: source } as unknown as HTMLIFrameElement;
  const options = {
    stageRef: { current: null }, inputPortRef: { current: null as CanvasSurfaceInputPort | null },
    enabled: true, expectedFrameCount: 1, mode: "smart" as const, tool: "pen" as const, gestureKey: "a",
  };
  let bridge: ReturnType<typeof useH5PointerBridge>, frame: ReturnType<typeof useH5FrameRegistration>;
  const render = () => {
    let runs = 0;
    do {
      if (++runs > 20) throw new Error("Hook render loop");
      // eslint-disable-next-line react-hooks/rules-of-hooks
      bridge = hooks.render(parent, () => useH5PointerBridge(options));
      // eslint-disable-next-line react-hooks/rules-of-hooks
      frame = hooks.render(child, () => useH5FrameRegistration(bridge.host, `runtime/${options.gestureKey}`));
      frame.iframeRef.current = iframe;
      hooks.flush(child);
      hooks.flush(parent);
    } while (parent.dirty || child.dirty);
  };
  render();
  frame!.onFrameLoad(); render();
  const hello = () => source.postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "pointer_hello").at(-1);
  const receive = (message = hello(), providerVersion = 1, type = "pointer_capabilities") => {
    window.dispatchEvent(Object.assign(new Event("message"), { source, data: {
      source: H5_POINTER_FRAME_SOURCE, schema: H5_POINTER_PROTOCOL_SCHEMA, version: H5_POINTER_PROTOCOL_VERSION,
      frameId: message.frameId, channelToken: message.channelToken, type,
      providerSchema: "mathin-classroom-input", providerVersion, defaultCapability: "click",
    } }));
    render();
  };
  return {
    source, hello, receive,
    status: () => bridge!.status,
    turn(page: string) { options.gestureKey = page; render(); },
    tick(ms: number) { vi.advanceTimersByTime(ms); render(); },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  vi.stubGlobal("window", Object.assign(new EventTarget(), { setInterval, clearInterval }));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  vi.stubGlobal("crypto", { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
});
afterEach(() => { hooks.dispose(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Smart H5 bridge lifecycle", () => {
  it("accepts the new handshake after a retained iframe changes page and ignores the old channel", () => {
    const h = harness();
    h.receive();
    expect(h.status()).toBe("ready");
    const previous = h.hello();
    h.turn("b");
    expect(h.hello().frameId).toBe("runtime/b");
    expect(h.hello().channelToken).not.toBe(previous.channelToken);
    h.receive(previous);
    expect(h.status()).toBe("pending");
    h.receive();
    expect(h.status()).toBe("ready");
    h.turn("a"); h.receive();
    expect(h.status()).toBe("ready");
  });

  it("recovers a timed-out heartbeat through a fresh handshake", () => {
    const h = harness(); h.receive();
    const previous = h.hello();
    h.tick(6250);
    expect(h.status()).toBe("timeout");
    h.tick(2000);
    expect(h.hello().channelToken).not.toBe(previous.channelToken);
    h.receive(previous, 1, "pointer_pong");
    expect(h.status()).toBe("pending");
    h.receive();
    expect(h.status()).toBe("ready");
  });

  it("retries a slow initial frame but retains the unavailable state for incompatible providers", () => {
    const h = harness();
    h.tick(2250);
    expect(h.status()).toBe("timeout");
    h.tick(2000);
    expect(h.status()).toBe("pending");
    h.receive();
    expect(h.status()).toBe("ready");
    h.turn("incompatible"); h.receive(undefined, 99);
    expect(h.status()).toBe("incompatible");
    const count = h.source.postMessage.mock.calls.length;
    h.tick(10000);
    expect(h.status()).toBe("incompatible");
    expect(h.source.postMessage.mock.calls).toHaveLength(count);
  });
});

// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LONG_PRESS_DELAY_MS, useLongPress, type LongPressOptions } from "@/hooks/use-long-press";

let root: Root, host: HTMLDivElement;
type Options = LongPressOptions<HTMLButtonElement>;
const shortPress = vi.fn(), longPress = vi.fn(), parentClick = vi.fn();
function Control({ options, name }: { options: Options; name: string }) {
  const press = useLongPress<HTMLButtonElement>(options);
  return createElement("button", { ...press, type: "button", "aria-label": name }, name);
}
async function render(options: Options = { onClick: shortPress, onLongPress: longPress }, second?: Options) {
  await act(async () => {
    root.render(createElement("div", { onClick: parentClick },
      createElement(Control, { key: "first", name: "first", options }),
      second && createElement(Control, { key: "second", name: "second", options: second })));
  });
}
const button = (name = "first") => host.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!;
async function pointer(type: string, target: EventTarget = button(), options: Partial<PointerEventInit> = {}) {
  await act(async () => {
    const values = { pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: 20, clientY: 30, button: 0, ...options };
    const event = new MouseEvent(type, { ...values, bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      pointerId: { value: values.pointerId }, pointerType: { value: values.pointerType }, isPrimary: { value: values.isPrimary },
    });
    target.dispatchEvent(event);
  });
}
const advance = (ms = DEFAULT_LONG_PRESS_DELAY_MS) => act(async () => { vi.advanceTimersByTime(ms); });
const click = (target = button(), detail = 1) => act(async () => { target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail })); });

beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  shortPress.mockClear(); longPress.mockClear(); parentClick.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("shared long-press recognition", () => {
  it("keeps ordinary pointer clicks and keyboard activation available", async () => {
    await render();
    await pointer("pointerdown"); await advance(499); await pointer("pointerup"); await click();
    expect(shortPress).toHaveBeenCalledOnce(); expect(longPress).not.toHaveBeenCalled();
    await click(button(), 0);
    expect(shortPress).toHaveBeenCalledTimes(2);
    await advance(); expect(longPress).not.toHaveBeenCalled();
  });

  it.each(["mouse", "touch", "pen"])("recognizes %s holds once, retains target coordinates and suppresses the release click", async (pointerType) => {
    await render();
    await pointer("pointerdown", button(), { pointerType });
    await advance();
    expect(longPress).toHaveBeenCalledExactlyOnceWith({ currentTarget: button(), pointerId: 1, pointerType, clientX: 20, clientY: 30 });
    await advance(1000); expect(longPress).toHaveBeenCalledOnce();
    await pointer("pointerup"); await click();
    expect(shortPress).not.toHaveBeenCalled(); expect(parentClick).not.toHaveBeenCalled();
    await click(button(), 0); expect(shortPress).toHaveBeenCalledOnce();
    await pointer("pointerdown"); await pointer("pointerup"); await click();
    expect(shortPress).toHaveBeenCalledTimes(2);
  });

  it("supports per-control delay and movement tolerance, with movement cancellation retained after returning to the start", async () => {
    await render({ onClick: shortPress, onLongPress: longPress, delayMs: 800, movementThresholdPx: 10 });
    await pointer("pointerdown");
    await pointer("pointermove", window, { clientX: 26, clientY: 38 });
    await advance(799); expect(longPress).not.toHaveBeenCalled();
    await advance(1); expect(longPress).toHaveBeenCalledOnce();
    await pointer("pointerup", window, { clientX: 26, clientY: 38 });
    await pointer("pointerdown");
    await pointer("pointermove", window, { clientX: 31 });
    await pointer("pointermove", window);
    await advance(800); await pointer("pointerup"); await click();
    expect(longPress).toHaveBeenCalledOnce(); expect(shortPress).not.toHaveBeenCalled();
  });

  it("cleans up matching cancellations, window blur, disabling and unmounting", async () => {
    await render();
    await pointer("pointerdown"); await pointer("pointercancel", window); await advance(); await click();
    expect(longPress).not.toHaveBeenCalled(); expect(shortPress).not.toHaveBeenCalled();
    await pointer("pointerdown");
    await act(async () => window.dispatchEvent(new Event("blur"))); await advance();
    expect(longPress).not.toHaveBeenCalled();
    await pointer("pointerdown"); await render({ onClick: shortPress, onLongPress: longPress, disabled: true }); await advance();
    await pointer("pointerdown"); await click();
    expect(longPress).not.toHaveBeenCalled(); expect(shortPress).not.toHaveBeenCalled();
    await render(); await pointer("pointerdown");
    await act(async () => root.render(null)); await advance();
    expect(longPress).not.toHaveBeenCalled();
  });

  it("ignores secondary starts and foreign pointer events, and observes releases even when a child stops propagation", async () => {
    await render();
    await pointer("pointerdown", button(), { button: 2 }); await advance();
    await pointer("pointerdown", button(), { isPrimary: false }); await advance();
    expect(longPress).not.toHaveBeenCalled();
    await pointer("pointerdown");
    await pointer("pointermove", window, { pointerId: 2, clientX: 400 });
    await pointer("pointercancel", window, { pointerId: 2 });
    await pointer("pointerup", window, { pointerId: 2 });
    await advance(); expect(longPress).toHaveBeenCalledOnce();
    await pointer("pointerup");
    button().addEventListener("pointerup", (event) => event.stopPropagation());
    await pointer("pointerdown"); await pointer("pointerup"); await advance();
    expect(longPress).toHaveBeenCalledOnce();
  });

  it("uses the latest callback during a hold and isolates independent controls", async () => {
    const updated = vi.fn(), other = vi.fn();
    await render(undefined, { onLongPress: other });
    await pointer("pointerdown"); await advance(250);
    await render({ onLongPress: updated }, { onLongPress: other });
    await advance(250);
    expect(longPress).not.toHaveBeenCalled(); expect(updated).toHaveBeenCalledOnce(); expect(other).not.toHaveBeenCalled();
    await pointer("pointerup");
    await pointer("pointerdown", button("second")); await advance(); await pointer("pointerup", button("second"));
    expect(other).toHaveBeenCalledOnce(); expect(updated).toHaveBeenCalledOnce();
  });

  it("allows callers to retain the native context menu", async () => {
    await render();
    const blocked = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    await act(async () => button().dispatchEvent(blocked)); expect(blocked.defaultPrevented).toBe(true);
    await render({ onLongPress: longPress, preventContextMenu: false });
    const allowed = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    await act(async () => button().dispatchEvent(allowed)); expect(allowed.defaultPrevented).toBe(false);
  });
});

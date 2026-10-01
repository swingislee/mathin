// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import { MotionLab } from "@/features/tools/motion-lab/MotionLab";
import { DEFAULT_LONG_PRESS_DELAY_MS } from "@/hooks/use-long-press";
import { DEFAULT_HEAD, DEFAULT_VEHICLE, EMPTY_VEHICLE, VEHICLES, type Runway } from "@/features/tools/motion-lab/shared";
import { initialMotionScene, motionSceneSchema, type MotionScene } from "@/features/tools/scenes/numeric-teaching-content";

const labels = en.tools.motion;
let host: HTMLDivElement, root: Root;
const snapshots = vi.fn<(scene: MotionScene | null) => void>();

function button(label: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((element) => element.getAttribute("aria-label") === label || element.textContent === label);
  expect(found, label).toBeTruthy();
  return found!;
}
function input(label: string) {
  const found = [...document.querySelectorAll<HTMLInputElement>("input")].find((element) => element.getAttribute("aria-label") === label);
  expect(found, label).toBeTruthy();
  return found!;
}
function snapshot() {
  const value = snapshots.mock.lastCall?.[0];
  expect(value).toBeTruthy();
  expect(motionSceneSchema.safeParse(value).success).toBe(true);
  return value!;
}
async function mount(runway: Partial<Runway> = {}, scene: Partial<MotionScene> = {}) {
  const initial = { ...initialMotionScene(), ...scene, runways: [{ ...initialMotionScene().runways[0], x: 50, ...runway }] };
  await act(async () => {
    // eslint-disable-next-line react/no-children-prop
    root.render(createElement(NextIntlClientProvider, { locale: "en", messages: en, timeZone: "UTC", children:
      createElement(MotionLab, { initial, onSnapshot: snapshots }) }));
  });
  return initial;
}
async function pointer(target: EventTarget, type: string, x = 300, y = 20, pointerId = 1, isPrimary = true) {
  await act(async () => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: isPrimary }, pointerType: { value: "touch" } });
    target.dispatchEvent(event);
  });
}
const advance = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
const click = (target: HTMLElement) => act(async () => { target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })); });
async function hold(target: HTMLElement) {
  await pointer(target, "pointerdown");
  await advance(DEFAULT_LONG_PRESS_DELAY_MS);
  await pointer(target, "pointerup");
  await click(target);
}
async function enter(target: HTMLInputElement, text: string, key = "Enter") {
  await act(async () => {
    target.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(target, text);
    target.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  snapshots.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("Motion Lab legacy interaction boundaries", () => {
  it("uses only the position handle for dragging and follows repeated, slow reversals within one gesture", async () => {
    const initial = await mount();
    for (const label of [labels.avatar, labels.chooseVehicle]) {
      const target = button(label);
      await pointer(target, "pointerdown");
      await pointer(window, "pointermove", 330);
      await pointer(target, "pointerup", 330);
      await click(target);
      expect(snapshot().runways[0].x).toBe(50);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    }

    const handle = button(labels.dragHandle), avatar = button(labels.avatar);
    await pointer(handle, "pointerdown");
    await pointer(window, "pointermove", 330);
    expect(avatar.style.transform).toBe("");
    await pointer(window, "pointermove", 329);
    expect(avatar.style.transform).toBe("scaleX(-1)");
    await pointer(window, "pointermove", 330);
    expect(avatar.style.transform).toBe("");
    await pointer(window, "pointermove", 320);
    expect(avatar.style.transform).toBe("scaleX(-1)");
    expect(snapshots.mock.lastCall![0]).toBeNull();
    await advance(1000);
    await pointer(window, "pointerup", 320);
    expect(avatar.style.transform).toBe("");
    expect(snapshot().runways[0]).toMatchObject({ facingRight: true, time: 1 });
    expect(snapshot().runways[0].x).toBeCloseTo(50 + 20 / 5.84);
    expect(initial.runways[0].x).toBe(50);
  });

  it("keeps the selected departure direction after dragging, cancellation and foreign pointer events", async () => {
    await mount({ facingRight: false });
    const handle = button(labels.dragHandle), avatar = button(labels.avatar);
    await pointer(handle, "pointerdown");
    await pointer(window, "pointermove", 350, 20, 2, false);
    expect(handle.getAttribute("aria-valuenow")).toBe("50");
    await pointer(window, "pointermove", 310);
    expect(avatar.style.transform).toBe("");
    await pointer(window, "pointercancel", 310, 20, 2, false);
    await pointer(window, "pointermove", 320);
    expect(Number(handle.getAttribute("aria-valuenow"))).toBeGreaterThan(53);
    await pointer(window, "pointercancel", 320);
    expect(avatar.style.transform).toBe("scaleX(-1)");
    const endX = snapshot().runways[0].x;
    await pointer(window, "pointermove", 390);
    expect(snapshot().runways[0].x).toBe(endX);
    expect(snapshot().runways[0].time).toBe(10);
  });

  it("restores the avatar and upload placeholder on long press without firing their short-click actions", async () => {
    await mount({ head: "data:image/png;base64,AAAA", vehicle: VEHICLES[2] });
    const picker = vi.spyOn(host.querySelector<HTMLInputElement>('input[type="file"]')!, "click");
    await hold(button(labels.avatar));
    expect(snapshot().runways[0].head).toBe(DEFAULT_HEAD);
    expect(picker).not.toHaveBeenCalled();
    await hold(button(labels.chooseVehicle));
    expect(snapshot().runways[0].vehicle).toBe(EMPTY_VEHICLE);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await pointer(button(labels.avatar), "pointerdown");
    await pointer(button(labels.avatar), "pointerup");
    await click(button(labels.avatar));
    expect(picker).toHaveBeenCalledOnce();
  });

  it("cancels long presses on movement, pointer cancellation and window blur", async () => {
    const custom = "data:image/png;base64,AAAA";
    await mount({ head: custom });
    const avatar = button(labels.avatar);
    await pointer(avatar, "pointerdown");
    await pointer(window, "pointermove", 300, 25);
    await pointer(window, "pointermove", 300, 20);
    await advance(600);
    await pointer(avatar, "pointerup");
    await click(avatar);
    expect(snapshot().runways[0].head).toBe(custom);
    await pointer(avatar, "pointerdown");
    await pointer(window, "pointercancel");
    await advance(600);
    expect(snapshot().runways[0].head).toBe(custom);
    await pointer(avatar, "pointerdown");
    await act(async () => window.dispatchEvent(new Event("blur")));
    await advance(600);
    expect(snapshot().runways[0].head).toBe(custom);
  });

  it("keeps the circular vehicle menu and its position/direction controls separate from the drag handle", async () => {
    await mount();
    await click(button(labels.chooseVehicle));
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    expect(document.activeElement).toBe(button(labels.vehicles.walk));
    await pointer(button(labels.vehicles.car), "pointerdown");
    await pointer(window, "pointermove", 350);
    await pointer(button(labels.vehicles.car), "pointerup", 350);
    expect(snapshot().runways[0].x).toBe(50);
    await click(button(labels.vehicles.car));
    expect(snapshot().runways[0]).toMatchObject({ vehicle: VEHICLES[2], speed: 15, x: 50 });
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    await enter(input(labels.position), "150");
    expect(snapshot().runways[0].x).toBe(100);
    expect(input(labels.position).value).toBe("100");
    await click(button(`${labels.flip} ←`));
    expect(snapshot().runways[0].facingRight).toBe(false);
    await enter(input(labels.position), "22.5");
    expect(snapshot().runways[0].x).toBe(22.5);
    await enter(input(labels.position), "80", "Escape");
    expect(snapshot().runways[0].x).toBe(22.5);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click(button(labels.chooseVehicle));
    expect(document.activeElement).toBe(button(labels.vehicles.car));
    await enter(input(labels.position), "");
    expect(snapshot().runways[0].x).toBe(22.5);
  });

  it("edits numbers with one click, normalizes drafts and restores the original long-press shortcuts", async () => {
    await mount({ distance: 60, speed: 6 }, { length: 200 });
    await click(button(labels.distance));
    expect(document.activeElement).toBe(input(labels.distance));
    await enter(input(labels.distance), "60.004");
    expect(button(labels.distance).textContent).toBe("60");
    await click(button(labels.speed));
    expect(snapshot().runways[0].solve).toBe("speed");
    await enter(input(labels.speed), "8", "Escape");
    expect(snapshot().runways[0]).toMatchObject({ solve: "speed", speed: 6 });
    await click(button(labels.speed));
    await enter(input(labels.speed), "7.5");
    expect(snapshot().runways[0]).toMatchObject({ speed: 7.5, distance: 75, time: 10 });
    await hold(button(labels.distance));
    expect(snapshot().runways[0]).toMatchObject({ distance: 200, solve: "time" });
    await hold(button(labels.time));
    expect(snapshot().runways[0]).toMatchObject({ time: 0, speed: 0, solve: "speed" });
    expect(document.querySelector(`input[aria-label="${labels.time}"]`)).toBeNull();
    await hold(button(labels.speed));
    expect(snapshot().runways[0]).toMatchObject({ speed: 0, distance: 0, solve: "distance" });
    await hold(button(labels.length));
    expect(snapshot().length).toBe(100);
  });

  it("locks every character and numeric control during playback", async () => {
    await mount();
    await click(button(labels.start));
    for (const label of [labels.avatar, labels.chooseVehicle, labels.dragHandle, labels.distance, labels.time, labels.speed, labels.length]) {
      expect(button(label).disabled).toBe(true);
    }
    expect(button(`${labels.distance} · ${labels.auto}`).disabled).toBe(true);
    await hold(button(labels.avatar));
    expect(snapshot().playback.phase).toBe("running");
    expect(snapshot().runways[0].vehicle).toBe(DEFAULT_VEHICLE);
  });

  it("keeps batch inputs, ruler and track actions direct while help opens on demand", async () => {
    await mount({ distance: 60, speed: 6 });
    expect(input(labels.allTime)).toBeTruthy();
    expect(input(labels.allSpeed)).toBeTruthy();
    expect(host.textContent).not.toContain(labels.dragHint);
    const rulerWasVisible = snapshot().showRuler;
    await click(button(labels.showRuler));
    expect(snapshot().showRuler).toBe(!rulerWasVisible);
    expect(button(labels.showRuler).getAttribute("aria-pressed")).toBe(String(!rulerWasVisible));
    await click(button(labels.addRunway));
    expect(snapshot().runways).toHaveLength(2);
    await click(button(labels.removeRunway));
    expect(snapshot().runways).toHaveLength(1);
    expect(button(labels.removeRunway).disabled).toBe(true);

    await enter(input(labels.allTime), "20");
    expect(snapshot().runways[0]).toMatchObject({ time: 20, speed: 3 });
    await enter(input(labels.allSpeed), "5", "Tab");
    await click(button(`${labels.apply} · ${labels.allSpeed}`));
    expect(snapshot().runways[0]).toMatchObject({ time: 20, speed: 5, distance: 100 });
    await enter(input(labels.allTime), "-1");
    expect(snapshot().allTime).toBe(20);
    await enter(input(labels.allTime), "99", "Escape");
    expect(input(labels.allTime).value).toBe("20");
    await click(button(labels.start));
    expect(input(labels.allTime).disabled).toBe(true);
    expect(input(labels.allSpeed).disabled).toBe(true);
    expect(button(`${labels.apply} · ${labels.allTime}`).disabled).toBe(true);

    await click(button(labels.help));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(labels.dragHint);
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await advance(0);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button(labels.help));
  });
});

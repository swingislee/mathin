// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaceValueWorkspace, type PlaceValueWorkspaceProps } from "@/features/tools/place-value/PlaceValueWorkspace";
import type { PlaceValueCanvasProps } from "@/features/tools/place-value/PlaceValueCanvas";
import { boardTotal, createDefaultPlaceValueInitial, createPlaceValueBoard, placeValueSnapshot, type PlaceValueSnapshot } from "@/features/tools/place-value/contract";
import { planPlaceValue } from "@/features/tools/place-value/model";

const viewport = vi.hoisted(() => ({ current: null as PlaceValueCanvasProps | null }));
vi.mock("next/dynamic", () => ({ default: () => function Viewport(props: PlaceValueCanvasProps) { viewport.current = props; return null; } }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
let root: Root, host: HTMLDivElement, serial = 0, now = 1000;
const frames = new Map<number, FrameRequestCallback>();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++serial, callback); return serial; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  now = 1000; vi.spyOn(Date, "now").mockImplementation(() => now);
  frames.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const render = async (props: PlaceValueWorkspaceProps = {}) => act(async () => root.render(createElement(PlaceValueWorkspace, props)));
function button(label: string) {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent === label);
  expect(found, label).toBeDefined(); return found!;
}
const click = async (label: string) => act(async () => button(label).click());
async function tick(time: number) { now = time; const tasks = [...frames.values()]; frames.clear(); await act(async () => tasks.forEach((callback) => callback(time))); }

describe("place-value workspace using common spatial controls", () => {
  it("automatically carries 99 + 1 in two separate motions, then keeps unpacking under teacher control", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await render({ initial: { ...createDefaultPlaceValueInitial(), left: createPlaceValueBoard(99), autoCarry: true } });
    await click("Add one unit"); await tick(1600);
    expect(viewport.current!.snapshot.left.ones).toHaveLength(10);
    await act(async () => { await vi.advanceTimersByTimeAsync(501); });
    expect(viewport.current!.snapshot.motion?.kind).toBe("carry-one");
    await tick(3800); expect(viewport.current!.snapshot.left.tens).toHaveLength(10);
    await act(async () => { await vi.advanceTimersByTimeAsync(501); });
    expect(viewport.current!.snapshot.motion?.kind).toBe("carry-ten");
    await tick(11000); expect(viewport.current!.snapshot.left.hundreds).toHaveLength(1);
    await click("One hundred becomes ten tens");
    expect(viewport.current!.snapshot.autoCarry).toBe(false);
    await tick(18200); await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(viewport.current!.snapshot.left.tens).toHaveLength(10);
  });
  it("adds, carries, pauses for observation, resumes and restores the prepared scene", async () => {
    const capture = vi.fn(); await render({ onSnapshot: capture });
    expect(capture.mock.lastCall![0]).toEqual(createDefaultPlaceValueInitial());
    await click("Add one unit"); expect(boardTotal(viewport.current!.snapshot.left)).toBe(10);
    expect(capture.mock.lastCall![0]).toBeNull(); expect(viewport.current!.interactive).toBe(true);
    await tick(1600); expect(capture.mock.lastCall![0].left.ones).toHaveLength(10);
    await click("Ten ones make one ten"); await tick(2700);
    expect(viewport.current!.progress).toBe(.5);
    await click("Pause process"); await tick(9000); expect(viewport.current!.progress).toBe(.5);
    expect(capture.mock.lastCall![0]).toBeNull();
    await click("Left"); expect(viewport.current!.snapshot.view).toBe("left");
    await click("Resume process"); await tick(10_100);
    expect(viewport.current!.progress).toBe(1); expect(capture.mock.lastCall![0].left.tens).toHaveLength(1);
    await click("Restore starting scene"); expect(capture.mock.lastCall![0]).toEqual(createDefaultPlaceValueInitial());
  });
  it("compares independent numbers on one camera, clears selection without changing number and shows no transform handles", async () => {
    await render(); await click("Compare numbers");
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>('[data-cube-canvas-panel] button')].find((b) => b.textContent === "Compare numbers")!.click());
    expect(viewport.current!.snapshot.mode).toBe("compare");
    await act(async () => host.querySelector<HTMLButtonElement>("[data-place-value-digits] button")!.click());
    expect(viewport.current!.snapshot.highlight).toBe("hundreds");
    const before = structuredClone(viewport.current!.snapshot);
    await act(async () => viewport.current!.onSelect("right", before.right.tens[0][0]));
    expect(viewport.current!.snapshot.active).toBe("right");
    await act(async () => viewport.current!.onPointerMissed(new MouseEvent("click", { button: 0 })));
    expect(viewport.current!.selected).toBe(false);
    expect(viewport.current!.snapshot.right).toEqual(before.right);
    expect(host.querySelector("[data-spatial-transform]")?.getAttribute("data-spatial-transform")).toBe("none");
    await click("Add one unit"); await tick(1600);
    expect(boardTotal(viewport.current!.snapshot.left)).toBe(9); expect(boardTotal(viewport.current!.snapshot.right)).toBe(21);
  });
  it("classroom commands await authority, acknowledge once and converge when joining in mid-animation", async () => {
    const initial = { ...createDefaultPlaceValueInitial(), left: createPlaceValueBoard(10, "ones") }, state = placeValueSnapshot(initial);
    const update = vi.fn(async (next: PlaceValueSnapshot) => { void next; });
    await render({ initial, classroom: { state, onChange: update } });
    await click("Ten ones make one ten"); expect(update).toHaveBeenCalledTimes(1);
    expect(viewport.current!.snapshot).toBe(state);
    const command = update.mock.calls[0][0]; now = 2100;
    await render({ initial, classroom: { state: command, onChange: update } }); await tick(2100);
    expect(viewport.current!.progress).toBe(.5);
    await render({ initial, classroom: { state: structuredClone(command), onChange: update } }); await tick(2650);
    expect(viewport.current!.progress).toBe(.75); expect(update).toHaveBeenCalledTimes(1);
    await click("Pause process"); expect(update.mock.lastCall![0].motion).toMatchObject({ progress: .75, paused: true });
    const late = planPlaceValue(state, "carry-one", 1000)!; now = 3200;
    await render({ initial, classroom: { state: late } }); await tick(3200);
    expect(viewport.current!.progress).toBe(1); expect(viewport.current!.interactive).toBe(false);
    expect(button("One ten becomes ten ones").disabled).toBe(true);
  });
  it("keeps the authoritative scene after a failed write and disables mutation on display clients", async () => {
    const initial = createDefaultPlaceValueInitial(), state = placeValueSnapshot(initial);
    const update = vi.fn().mockRejectedValue(new Error("offline"));
    await render({ initial, classroom: { state, onChange: update } }); await click("Add one unit");
    expect(viewport.current!.snapshot).toBe(state); expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await render({ initial, readOnly: true });
    expect(button("Add one unit").disabled).toBe(true);
  });
});

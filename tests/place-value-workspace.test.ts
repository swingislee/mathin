// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaceValueWorkspace, type PlaceValueWorkspaceProps } from "@/features/tools/place-value/PlaceValueWorkspace";
import type { PlaceValueCanvasProps } from "@/features/tools/place-value/PlaceValueCanvas";
import { boardTotal, createDefaultPlaceValueInitial, createPlaceValueBoard, placeValueSnapshot, type PlaceValueSnapshot } from "@/features/tools/place-value/radix-contract";
import { planPlaceValue } from "@/features/tools/place-value/radix-model";

const viewport = vi.hoisted(() => ({ current: null as PlaceValueCanvasProps | null }));
vi.mock("next/dynamic", () => ({ default: () => function Viewport(props: PlaceValueCanvasProps) {
  viewport.current = props;
  return createElement("div", null, (props.snapshot.mode === "compare" ? ["left", "right"] as const : ["left"] as const).flatMap((side) =>
    [...props.snapshot.left.places.keys()].reverse().map((place) => createElement("div", { key: side + place }, props.renderPlaceControl?.(side, place), place < props.snapshot.left.places.length - 1 ? props.renderCarryControl?.(side, place) : null))));
} }));
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
  const found = [...host.querySelectorAll<HTMLButtonElement>('button:not([aria-hidden="true"])')].find((item) => item.getAttribute("aria-label") === label || item.textContent === label);
  expect(found, label).toBeDefined(); return found!;
}
const click = async (label: string) => act(async () => button(label).click());
async function tick(time: number) { now = time; const tasks = [...frames.values()]; frames.clear(); await act(async () => tasks.forEach((callback) => callback(time))); }

describe("place-value workspace using common spatial controls", () => {
  it("keeps SVG-only +/- responsive below ten, then protects 9/+1 until carrying without shifting the toolbar", async () => {
    await render({ initial: { ...createDefaultPlaceValueInitial(), left: createPlaceValueBoard(7) } });
    const toolbar = () => [...host.querySelectorAll('[role="toolbar"] [data-spatial-action]')].map((node) => node.getAttribute("data-spatial-action"));
    const before = toolbar();
    expect(button("Add one unit").querySelector("svg")).not.toBeNull();
    expect(button("Add one unit").textContent).toBe("");
    await click("Add one unit");
    expect(button("Add one unit").disabled).toBe(false); expect(button("Take away one unit").disabled).toBe(false);
    await click("Add one unit"); expect(viewport.current!.snapshot.left.places[0]).toHaveLength(9);
    await click("Add one unit");
    for (const label of ["Add one unit", "Take away one unit", "Add one Tens unit", "Add one Hundreds unit", "Edit Ones digit", "Edit Tens digit", "Edit Hundreds digit"]) expect(button(label).disabled).toBe(true);
    expect(button("Ten ones make one ten").disabled).toBe(false);
    expect(button("Ten ones make one ten").getAttribute("data-carry-between")).toBe("left:0:1");
    expect(button("Ten ones make one ten").closest("[data-place-value-station]")).toBeNull();
    expect(host.querySelector('[data-place-value-station="left:0"] [data-place-value-numeral="after"]')!.textContent).toBe("9+1");
    expect(toolbar()).toEqual(before); expect(host.textContent).not.toContain("Written number");
    await click("Add one unit"); await click("Take away one unit"); expect(viewport.current!.snapshot.left.places[0]).toHaveLength(10);
    await click("Edit Ones digit"); expect(host.querySelector('input[aria-label="Edit Ones digit"]')).toBeNull();
    await click("Ten ones make one ten"); expect(button("Add one unit").disabled).toBe(true);
    expect(toolbar()).toEqual(before); await tick(2100); expect(viewport.current!.progress).toBe(.5);
    expect(host.querySelector('[data-place-value-station="left:0"] [data-place-value-numeral="before"]')!.textContent).toBe("9+1");
    await tick(3200); expect(button("Add one unit").disabled).toBe(false);
    expect(host.querySelector('[data-place-value-station="left:1"] [data-place-value-numeral="after"]')!.textContent).toBe("1");
    expect(toolbar()).toEqual(before);
  });
  it("keeps 99 + 1 protected across both carry steps and blocks panel quantity shortcuts", async () => {
    await render({ initial: { ...createDefaultPlaceValueInitial(), left: createPlaceValueBoard(99) } });
    await click("Add one unit");
    expect(button("One ten becomes ten ones").disabled).toBe(true);
    await click("Prepare number and groups");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Set number"]')!.disabled).toBe(true);
    expect(button("Arrange").disabled).toBe(true); expect(button("100").disabled).toBe(true);
    await click("Ten ones make one ten");
    await tick(3200);
    expect(viewport.current!.snapshot.left.places[1]).toHaveLength(10);
    expect(button("Add one unit").disabled).toBe(true); expect(button("Edit Tens digit").disabled).toBe(true);
    expect(button("Ten tens make one hundred").disabled).toBe(false);
    await click("Ten tens make one hundred"); await tick(6800);
    expect(button("Add one unit").disabled).toBe(true); expect(button("Pause process").disabled).toBe(false);
    await tick(10400);
    expect(viewport.current!.snapshot.left.places[2]).toHaveLength(1);
    expect(button("Add one unit").disabled).toBe(false); expect(button("Edit Tens digit").disabled).toBe(false);
    expect(button("Arrange").disabled).toBe(false);
  });
  it("offers only the lowest required carry for a prepared scene with both places full", async () => {
    const board = createPlaceValueBoard(110, "tens"), ten = board.places[1].pop()!;
    board.places[0] = Array.from({ length: 10 }, (_, i) => [{ start: ten[0].start + i, count: 1, phase: i }]);
    await render({ initial: { ...createDefaultPlaceValueInitial(), left: board } });
    expect(button("Ten ones make one ten").disabled).toBe(false);
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Ten tens make one hundred"]')!.disabled).toBe(true);
    expect(button("Add one unit").disabled).toBe(true);
  });
  it("edits a digit in its own position, preserves the other places, and supports escape to cancel", async () => {
    await render({ initial: { ...createDefaultPlaceValueInitial(), left: createPlaceValueBoard(234) } });
    const before = viewport.current!.snapshot.left;
    await click("Edit Tens digit");
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Edit Tens digit"]')!;
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "6");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input.blur());
    expect(boardTotal(viewport.current!.snapshot.left)).toBe(264);
    expect(viewport.current!.snapshot.left.places[0]).toEqual(before.places[0]); expect(viewport.current!.snapshot.left.places[2]).toEqual(before.places[2]);
    await click("Edit Ones digit");
    await act(async () => host.querySelector<HTMLInputElement>('input[aria-label="Edit Ones digit"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(boardTotal(viewport.current!.snapshot.left)).toBe(264);
  });
  it("settles the terminal frame even when wall time is rounded just short, and resumes a scrubbed motion", async () => {
    await render(); await click("Add one unit"); await tick(1000);
    now = 1179;
    const tasks = [...frames.values()]; frames.clear(); await act(async () => tasks.forEach((callback) => callback(1180)));
    expect(viewport.current!.progress).toBe(1);
    now = 1180; await click("Ten ones make one ten"); await tick(3380);
    await click("Inspect a counting unit");
    // A replayed, paused classroom command uses its own timeline, not the previous completed frame.
    const paused = { ...viewport.current!.snapshot, motion: { ...viewport.current!.snapshot.motion!, startedAt: now, progress: .25, paused: true } };
    await render({ classroom: { state: paused, onChange: async () => {} } }); expect(viewport.current!.progress).toBe(.25);
    const resumed = { ...paused, motion: { ...paused.motion, paused: false } };
    await render({ classroom: { state: resumed, onChange: async () => {} } }); await tick(3380);
    expect(viewport.current!.progress).toBe(.25);
  });
  it("automatically carries 99 + 1 in two separate motions, then keeps unpacking under teacher control", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await render({ initial: { ...createDefaultPlaceValueInitial(), left: createPlaceValueBoard(99), autoCarry: true } });
    await click("Add one unit"); await tick(1600);
    expect(viewport.current!.snapshot.left.places[0]).toHaveLength(10);
    await act(async () => { await vi.advanceTimersByTimeAsync(501); });
    expect(viewport.current!.snapshot.motion?.kind).toBe("carry");
    await tick(3800); expect(viewport.current!.snapshot.left.places[1]).toHaveLength(10);
    await act(async () => { await vi.advanceTimersByTimeAsync(501); });
    expect(viewport.current!.snapshot.motion?.kind).toBe("carry");
    await tick(11000); expect(viewport.current!.snapshot.left.places[2]).toHaveLength(1);
    await click("One hundred becomes ten tens");
    expect(viewport.current!.snapshot.autoCarry).toBe(false);
    await tick(18200); await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(viewport.current!.snapshot.left.places[1]).toHaveLength(10);
    await click("One ten becomes ten ones"); await tick(20400);
    expect(button("Take away one unit").disabled).toBe(false);
    await click("Take away one unit"); expect(boardTotal(viewport.current!.snapshot.left)).toBe(99);
  });
  it("adds, carries, pauses for observation, resumes and restores the prepared scene", async () => {
    const capture = vi.fn(); await render({ onSnapshot: capture });
    expect(capture.mock.lastCall![0]).toEqual(createDefaultPlaceValueInitial());
    await click("Add one unit"); expect(boardTotal(viewport.current!.snapshot.left)).toBe(10);
    expect(capture.mock.lastCall![0]).toBeNull(); expect(viewport.current!.interactive).toBe(true);
    await tick(1600); expect(capture.mock.lastCall![0].left.places[0]).toHaveLength(10);
    await click("Ten ones make one ten"); await tick(2700);
    expect(viewport.current!.progress).toBe(.5);
    await click("Pause process"); await tick(9000); expect(viewport.current!.progress).toBe(.5);
    expect(capture.mock.lastCall![0]).toBeNull();
    await click("Left"); expect(viewport.current!.snapshot.view).toBe("left");
    await click("Resume process"); await tick(10_100);
    expect(viewport.current!.progress).toBe(1); expect(capture.mock.lastCall![0].left.places[1]).toHaveLength(1);
    await click("Restore starting scene"); expect(capture.mock.lastCall![0]).toEqual(createDefaultPlaceValueInitial());
  });
  it("compares independent numbers on one camera, clears selection without changing number and shows no transform handles", async () => {
    await render(); await click("Compare numbers");
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>('[data-cube-canvas-panel] button')].find((b) => b.textContent === "Compare numbers")!.click());
    expect(viewport.current!.snapshot.mode).toBe("compare");
    await act(async () => host.querySelector<HTMLButtonElement>("[data-place-value-digits] button")!.click());
    expect(viewport.current!.snapshot.highlight).toBe(2);
    const before = structuredClone(viewport.current!.snapshot);
    await act(async () => viewport.current!.onSelect("right", before.right.places[1][0][0].start));
    expect(viewport.current!.snapshot.active).toBe("right");
    await act(async () => viewport.current!.onPointerMissed(new MouseEvent("click", { button: 0 })));
    expect(viewport.current!.selected).toBe(false);
    expect(viewport.current!.snapshot.right).toEqual(before.right);
    expect(host.querySelector("[data-spatial-transform]")?.getAttribute("data-spatial-transform")).toBe("none");
    await act(async () => host.querySelector<HTMLButtonElement>('[data-place-value-station="right:0"] button[aria-label="Add one unit"]')!.click()); await tick(1600);
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
    const late = planPlaceValue(state, "carry", 1000)!; now = 3200;
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
  it("selects bases and six places without changing totals, and accepts hexadecimal digits in position", async () => {
    await render(); await click("Structure and display");
    await click("Base 16"); await click("Number of places 6");
    expect(viewport.current!.snapshot.left.radix).toBe(16);
    expect(viewport.current!.snapshot.left.places).toHaveLength(6);
    expect(boardTotal(viewport.current!.snapshot.left)).toBe(9);
    expect(boardTotal(viewport.current!.snapshot.right)).toBe(20);
    expect(button("Base 16").getAttribute("aria-pressed")).toBe("true");
    await click("Edit 16⁰ digit");
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Edit 16⁰ digit"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "F");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input.blur());
    expect(boardTotal(viewport.current!.snapshot.left)).toBe(15);
    expect(host.querySelector('[data-place-value-station="left:0"] [data-place-value-numeral="after"]')!.textContent).toBe("F");
    await click("Add one unit");
    expect(button("16 × 16⁰ → 1 × 16¹").disabled).toBe(false);
    expect(button("Base 10").disabled).toBe(true);
  });
  it("keeps saved v1 scenes on their original contract while sharing the same workspace", async () => {
    await render({ legacy: true }); await click("Structure and display");
    expect(host.querySelector('button[aria-label="Base 16"]')).toBeNull();
    expect(host.textContent).toContain("three decimal places");
    expect(button("Add one unit").disabled).toBe(false);
  });
});
